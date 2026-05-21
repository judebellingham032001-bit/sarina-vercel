// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (v10)
// ==========================================

const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

// Tambahkan ini tepat di bawah const app = express();
app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

function splitCSV(line) {
    const result = [];
    let cur = '';
    let inQuote = false;
    if (!line) return [];
    for (let char of line) {
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
        else cur += char;
    }
    result.push(cur.trim());
    return result;
}

function formatRP(angkaStr) {
    if (!angkaStr || angkaStr === "0" || angkaStr === "-") return "0";
    let bersih = angkaStr.replace(/[^\d-]/g, "");
    if (bersih === "" || bersih === "-") return "0";
    let isMinus = bersih.startsWith("-");
    let angka = Math.abs(parseInt(bersih));
    let formatted = "Rp " + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return isMinus ? "-" + formatted : "+ " + formatted;
}

app.get('/', async (req, res) => {
    try {
        // 1. DAFTAR URL SOURCE GOOGLE SHEETS
        const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
        const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
        const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";
        
        // URL Tab Packaging Baru Berdasarkan Gambar Terbaru Anda (Sudah Diarahkan ke ID Spreadsheet Baru)
        const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFlandJGLnlZMrwR-19m5hMA7E4E/export?format=csv&gid=0";

        // Fetch data secara paralel dengan penanganan error mandiri (.catch) di setiap request
        const [resS, resR, resK, resP] = await Promise.all([
            axios.get(urlS).catch(err => { console.error("Error Stok:", err.message); return { data: "" }; }),
            axios.get(urlR).catch(err => { console.error("Error Ship:", err.message); return { data: "" }; }),
            axios.get(urlK).catch(err => { console.error("Error Kas:", err.message); return { data: "" }; }),
            axios.get(urlP).catch(err => { console.error("Error Pack:", err.message); return { data: "" }; })
        ]);

        // 2. PARSING DATA TAB STOK
        let lastUpdate = "-";
        let stocks = [];
        if (resS.data) {
            const linesS = resS.data.split(/\r?\n/);
            lastUpdate = splitCSV(linesS[0])[0] || "-"; 
            stocks = linesS.slice(13).map(l => {
                const c = splitCSV(l);
                let status = "TERSEDIA";
                if (parseFloat(c[1]) <= 0) status = "OUT OF STOCK";
                else if (parseFloat(c[1]) <= 2) status = "LOW";
                return { nama: c[0], qty: parseFloat(c[1]) || 0, display: c[3] || "0", statusTxt: status };
            }).filter(i => i.nama);
        }

        // 3. PARSING DATA TAB PENGIRIMAN
        let shippingAll = [];
        if (resR.data) {
            shippingAll = resR.data.split(/\r?\n/).slice(3).map(l => {
                const c = splitCSV(l);
                return { 
                    tgl: c[6] || "", 
                    spx: c[7] || "0", 
                    jne: c[8] || "0", 
                    jnt: c[9] || "0", 
                    sd: c[10] || "0", 
                    tot: c[11] || "0" 
                };
            }).filter(i => i.tgl && i.tgl !== "0");
        }

        // 4. PARSING DATA TAB KAS
        let kasAll = [];
        let saldoTotalRaw = "0";
        let isSaldoMinus = false;
        if (resK.data) {
            const linesK = resK.data.split(/\r?\n/);
            let tempDate = ""; 
            kasAll = linesK.slice(5).map(l => {
                const c = splitCSV(l);
                if (c[0] && c[0].trim() !== "") tempDate = c[0];
                let linkBukti = (c[3] && c[3].toLowerCase().includes('http')) ? c[3].trim().replace(/^"|"$/g, '') : "";
                let mutasiRaw = "0";
                let tipe = "netral";
                if (c[4] && c[4] !== "0" && c[4] !== "-") { mutasiRaw = "-" + c[4]; tipe = "debet"; }
                else if (c[5] && c[5] !== "0" && c[5] !== "-") { mutasiRaw = c[5]; tipe = "kredit"; }

                return { 
                    tgl: tempDate, kat: c[1] || "", ket: c[2] || "", mutasi: formatRP(mutasiRaw),
                    tipeMutasi: tipe, saldo: formatRP(c[6] || "0"), bukti: linkBukti 
                };
            }).filter(t => t.kat && t.kat !== "Kategori" && t.kat !== "");

            if (kasAll.length > 0) {
                saldoTotalRaw = kasAll[kasAll.length - 1].saldo.replace(/[^\d-]/g, "");
                isSaldoMinus = saldoTotalRaw.startsWith("-");
            }
        }

        // 5. PARSING DATA TAB PACKAGING
        let packagingAll = [];
        if (resP.data) {
            const linesP = resP.data.split(/\r?\n/);
            // Slice(1) berarti kita melewati baris ke-1 (Product, 100g, 200g, 250g, dst)
            packagingAll = linesP.slice(1).map(l => {
                const c = splitCSV(l);
                // Jika baris kosong atau tidak ada nama produk, abaikan
                if (!c[0] || c[0].trim() === "" || c[0].toLowerCase() === 'product') return null;
                
                return {
                    nama: c[0].trim(),
                    g100: c[1] || "-",
                    g200: c[2] || "-",
                    g250: c[3] || "-",
                    g400: c[4] || "-",
                    g500: c[5] || "-",
                    k1: c[6] || "-"
                };
            }).filter(p => p !== null);
        }

        // 6. RENDER DATA KE VIEW
        res.render('index', { 
            stocks, 
            shippingAll, 
            kasAll, 
            packagingAll, 
            saldoTotal: formatRP(saldoTotalRaw).replace('+', ''), 
            isSaldoMinus, 
            lastUpdate 
        });
    } catch (e) {
        console.error("Fatal Error Dashboard:", e);
        res.status(500).send("Gagal memuat data operasional: " + e.message);
    }
});

module.exports = app;
