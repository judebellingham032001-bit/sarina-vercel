// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (v29-FIX-LINK)
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

// Fungsi format Rupiah (Versi Aman)
function formatRP(angkaStr) {
    try {
        if (!angkaStr || angkaStr === "0" || angkaStr === "-") return "0";
        let bersih = angkaStr.replace(/[^\d-]/g, "");
        if (bersih === "" || bersih === "-") return "0";
        
        let isMinus = bersih.startsWith("-");
        let parsedInt = parseInt(bersih.replace(/[^0-9]/g, ''));
        
        if (isNaN(parsedInt)) return "0";
        
        let angka = Math.abs(parsedInt);
        let formatted = "Rp " + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        return isMinus ? "-" + formatted : "+ " + formatted;
    } catch (err) {
        return "0";
    }
}

app.get('/', async (req, res) => {
    // Sediakan penampung data darurat agar EJS tidak crash jika Google Sheets overload
    let stocks = [];
    let shippingAll = [];
    let kasAll = [];
    let packagingAll = [];
    let packagingHeaders = [];
    let lastUpdate = "-";
    let saldoTotalRaw = "0";
    let isSaldoMinus = false;

    // 1. DAFTAR URL SOURCE GOOGLE SHEETS
    const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
    const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
    const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";
    
    // FIX LINK: Menggunakan huruf I besar (FIand) sesuai link asli dari kamu, dan diekspor ke CSV
    const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFIandJGLnlZMrwR-19m5hMA7E4E/export?format=csv"; 

    // Fetch data paralel dari Google Sheets
    const [resS, resR, resK, resP] = await Promise.all([
        axios.get(urlS).catch(err => { console.error("Gagal load Tab Stok:", err.message); return { data: "" }; }),
        axios.get(urlR).catch(err => { console.error("Gagal load Tab Ship:", err.message); return { data: "" }; }),
        axios.get(urlK).catch(err => { console.error("Gagal load Tab Kas:", err.message); return { data: "" }; }),
        axios.get(urlP).catch(err => { console.error("Gagal load Tab Pack:", err.message); return { data: "" }; })
    ]);

    // 2. PARSING TAB STOK
    try {
        if (resS.data && resS.data.trim() !== "") {
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
    } catch (errStok) {
        console.error("Gagal parsing stok:", errStok.message);
    }

    // 3. PARSING TAB PENGIRIMAN
    try {
        if (resR.data && resR.data.trim() !== "") {
            shippingAll = resR.data.split(/\r?\n/).slice(3).map(l => {
                const c = splitCSV(l);
                return { 
                    tgl: c[6] || "", spx: c[7] || "0", jne: c[8] || "0", jnt: c[9] || "0", sd: c[10] || "0", tot: c[11] || "0" 
                };
            }).filter(i => i.tgl && i.tgl !== "0");
        }
    } catch (errShip) {
        console.error("Gagal parsing shipping:", errShip.message);
    }

    // 4. PARSING TAB KAS
    try {
        if (resK.data && resK.data.trim() !== "") {
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
    } catch (errKas) {
        console.error("Gagal parsing kas:", errKas.message);
    }

    // 5. PARSING TAB PACKAGING DINAMIS 
    try {
        if (resP.data && resP.data.trim() !== "") {
            const linesP = resP.data.split(/\r?\n/).filter(line => line.trim() !== "");
            
            if (linesP.length > 0) {
                const barisHeader = splitCSV(linesP[0]);
                
                // Ambil header ukuran dari Kolom B ke kanan secara dinamis
                for (let h = 1; h < barisHeader.length; h++) {
                    let headText = barisHeader[h].trim();
                    if (!headText || headText === "") continue; 
                    packagingHeaders.push(headText.toUpperCase());
                }

                // Loop baris produk (Mulai index 1 ke bawah)
                for (let i = 1; i < linesP.length; i++) {
                    const c = splitCSV(linesP[i]);
                    
                    // Lewati baris kalau kolom produk kosong atau berisi text template header
                    if (!c[0] || c[0].trim() === "" || c[0].toLowerCase() === "product") continue;
                    
                    let ukuranData = [];
                    for (let j = 0; j < packagingHeaders.length; j++) {
                        let cellValue = c[j + 1]; 
                        ukuranData.push((cellValue && cellValue.trim() !== "") ? cellValue.trim() : "-");
                    }

                    packagingAll.push({
                        nama: c[0].trim(),
                        listUkuran: ukuranData
                    });
                }
            }
        }
    } catch (errPack) {
        console.error("Gagal parsing packaging:", errPack.message);
    }

    // 6. RENDER DATA KE INDEX.EJS
    res.render('index', { 
        stocks, 
        shippingAll, 
        kasAll, 
        packagingAll, 
        packagingHeaders, 
        saldoTotal: formatRP(saldoTotalRaw).replace('+', ''), 
        isSaldoMinus, 
        lastUpdate
    });
});

module.exports = app;
