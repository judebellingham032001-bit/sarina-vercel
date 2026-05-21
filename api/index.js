// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (v27-DYNAMIC-FIX)
// ==========================================

const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Fungsi pemisah CSV tangguh
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

// Fungsi format Rupiah
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
        const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFIandJGLnlZMrwR-19m5hMA7E4E/export?format=csv"; 

        // Fetch data paralel (Axios bawaan kamu yang terbukti aman)
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

        // 5. PARSING DATA TAB PACKAGING (SISTEM DETEKSI DINAMIS TOTAL)
        let packagingAll = [];
        let packagingHeaders = [];
        
        if (resP.data && resP.data.trim() !== "") {
            const linesP = resP.data.split(/\r?\n/).filter(line => line.trim() !== "");
            
            if (linesP.length > 0) {
                // Baris pertama murni dibaca sebagai Header Ukuran (Product, 100g, 200g, dst)
                const barisHeader = splitCSV(linesP[0]);
                
                // Ambil semua kolom ukuran dari Kolom B (index 1) sampai ujung kanan sheet yang ada isinya
                for (let h = 1; h < barisHeader.length; h++) {
                    let headText = barisHeader[h].trim();
                    if (!headText || headText === "") {
                        // Jika ada kolom kosong di tengah, kita lewati atau stop agar rapi
                        continue; 
                    }
                    packagingHeaders.push(headText.toUpperCase());
                }

                // Ambil data produk mulai dari baris ke-2 (index 1) sampai paling bawah
                for (let i = 1; i < linesP.length; i++) {
                    const c = splitCSV(linesP[i]);
                    
                    // VALIDASI: Lewati baris jika nama produk di kolom A kosong atau isinya cuma teks header
                    if (!c[0] || c[0].trim() === "" || c[0].toLowerCase() === "product") continue;
                    
                    // Ambil isi datanya disesuaikan dengan jumlah kolom header yang aktif saat ini
                    let ukuranData = [];
                    for (let j = 0; j < packagingHeaders.length; j++) {
                        let cellValue = c[j + 1]; // Geser index 1 karena kolom pertama (0) adalah Nama Produk
                        ukuranData.push((cellValue && cellValue.trim() !== "") ? cellValue.trim() : "-");
                    }

                    packagingAll.push({
                        nama: c[0].trim(),
                        listUkuran: ukuranData
                    });
                }
            }
        }

        // 6. RENDER DATA KE VIEW EJS
        res.render('index', { 
            stocks, 
            shippingAll, 
            kasAll, 
            packagingAll, 
            packagingHeaders, // Array header dikirim ke EJS agar th ke-kanan digambar otomatis
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
