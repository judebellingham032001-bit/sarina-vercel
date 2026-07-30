// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (v23-CELL-M1-FIX-OBJECT-OBJECT)
// ==========================================

const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

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

// HELPER FUNCTION: Konversi Desimal + Teks ("2,5 ikat") ke Pecahan Kecil ("2 ½ ikat") & Cek Merah (<3)
function processKemasanCell(val) {
    if (!val || val === "-" || val.trim() === "") {
        return { displayTxt: "-", isLow: false };
    }
    
    let rawStr = val.toString().trim();

    // 1. Ekstrak kata satuan jika ada (seperti "ikat", "pcs", "pack")
    let unitTxt = rawStr.replace(/[0-9.,-]/g, '').trim();

    // 2. Ekstrak angka murni (ubah koma ke titik)
    let angkaBersih = rawStr.replace(/,/g, '.').replace(/[^0-9.-]/g, '');
    let num = parseFloat(angkaBersih);

    // Jika tidak ada angka sama sekali
    if (isNaN(num)) {
        return { displayTxt: rawStr, isLow: false };
    }

    // 3. Cek Status Merah jika di bawah 3 (< 3)
    let isLow = num < 3;

    if (num === 0) {
        return { displayTxt: "0" + (unitTxt ? " " + unitTxt : ""), isLow: true };
    }

    let utuh = Math.floor(Math.abs(num));
    let sisa = Math.abs(num) - utuh;
    let pecahanTxt = "";

    // Menggunakan Unicode Pecahan Kecil
    if (Math.abs(sisa - 0.25) < 0.05) pecahanTxt = "¼";
    else if (Math.abs(sisa - 0.5) < 0.05) pecahanTxt = "½";
    else if (Math.abs(sisa - 0.75) < 0.05) pecahanTxt = "¾";
    else if (Math.abs(sisa - 0.33) < 0.05) pecahanTxt = "⅓";
    else if (Math.abs(sisa - 0.66) < 0.05) pecahanTxt = "⅔";
    else if (sisa >= 0.95) { utuh += 1; pecahanTxt = ""; }

    let prefix = num < 0 ? "-" : "";
    let hasilAngka = "";

    if (utuh === 0 && pecahanTxt !== "") {
        hasilAngka = prefix + pecahanTxt;
    } else if (pecahanTxt !== "") {
        hasilAngka = prefix + utuh + " " + pecahanTxt;
    } else {
        hasilAngka = prefix + utuh;
    }

    // Gabungkan angka pecahan dengan kata satuan asli (contoh: "2 ½ ikat")
    let displayTxt = hasilAngka + (unitTxt ? " " + unitTxt : "");

    return { displayTxt, isLow };
}

app.get('/', async (req, res) => {
    try {
        // 1. DAFTAR URL SOURCE GOOGLE SHEETS
        const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
        const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
        const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";
        const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFIandJGLnlZMrwR-19m5hMA7E4E/export?format=csv&gid=0";

        // Fetch data paralel kilat
        const [resS, resR, resK, resP] = await Promise.all([
            axios.get(urlS).catch(err => { console.error("Error Stok:", err.message); return { data: "" }; }),
            axios.get(urlR).catch(err => { console.error("Error Ship:", err.message); return { data: "" }; }),
            axios.get(urlK).catch(err => { console.error("Error Kas:", err.message); return { data: "" }; }),
            axios.get(urlP).catch(err => { console.error("Error Pack:", err.message); return { data: "" }; })
        ]);

        // 2. PARSING DATA TAB STOK PRODUK
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
                    tgl: c[6] || "", spx: c[7] || "0", jne: c[8] || "0", jnt: c[9] || "0", sd: c[10] || "0", tot: c[11] || "0" 
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

        // 5. PARSING DATA TAB PACKAGING (STOK KEMASAN)
        let packagingAll = [];
        let packHeaders = [];
        let lastUpdatePack = "-";

        if (resP.data && resP.data.trim() !== "") {

            const linesP =
                resP.data
                .split(/\r?\n/)
                .filter(line => line.trim() !== "");

            // AMBIL LAST UPDATE DARI M2
            if (linesP.length > 1) {
                const barisKedua = splitCSV(linesP[1]);
                if (barisKedua[12] && barisKedua[12].trim() !== "") {
                    lastUpdatePack = barisKedua[12].trim();
                }
            }

            // AMBIL HEADER DARI ROW 1
            if (linesP.length > 0) {
                const barisPertama = splitCSV(linesP[0]);
                for (let h = 1; h < barisPertama.length; h++) {
                    let headName = barisPertama[h] ? barisPertama[h].trim() : "";
                    if (!headName || h >= 12 || headName.toLowerCase().includes("update")) break;
                    packHeaders.push(headName.toUpperCase());
                }
            }

            // LOOP DATA PRODUK KEMASAN
            for (let i = 1; i < linesP.length; i++) {
                const c = splitCSV(linesP[i]);

                if (!c[0] || c[0].trim() === "" || c[0].toLowerCase() === "product") continue;

                let listVarian = [];

                for (let vIdx = 0; vIdx < packHeaders.length; vIdx++) {
                    let nilaiKolom = c[vIdx + 1];
                    let valClean = (nilaiKolom && nilaiKolom.trim() !== "") ? nilaiKolom.trim() : "-";
                    
                    // PROSES CELL: Dapatkan Teks Pecahan Kecil + Flag Merah
                    let cellData = processKemasanCell(valClean);

                    listVarian.push(cellData);
                }

                packagingAll.push({
                    nama: c[0].trim(),
                    gramasi: c[1] || "-",
                    listVarian
                });
            }
        }

        if (lastUpdatePack === "-") {
            lastUpdatePack = "Belum Diupdate";
        }

        // 6. RENDER KE VIEW
        res.render('index', { 
            stocks, 
            shippingAll, 
            kasAll, 
            packagingAll, 
            packHeaders, 
            saldoTotal: formatRP(saldoTotalRaw).replace('+', ''), 
            isSaldoMinus, 
            lastUpdate,
            lastUpdatePack
        });
    } catch (e) {
        console.error("Fatal Error Dashboard:", e);
        res.status(500).send("Gagal memuat data operasional: " + e.message);
    }
});

module.exports = app;
