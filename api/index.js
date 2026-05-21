// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (v22-DYNAMIS-ROUTER-FIX)
// ==========================================

const express = require('express');
const axios = require('axios');
const app = express.Router(); // Murni pakai Router bawaan Vercel kamu agar tidak crash

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

// Handler dengan pencarian parameter fleksibel agar tidak tertukar di serverless
app.get('/', async function(...args) {
    const req = args.find(a => a && a.query !== undefined) || args[0];
    const res = args.find(a => a && typeof a.render === 'function') || args[1];

    if (!res || typeof res.render !== 'function') {
        return args[0] && typeof args[0].send === 'function' 
            ? args[0].status(500).send("Gagal: Object response Express tidak valid.")
            : console.error("Express res.render tidak ditemukan.");
    }

    try {
        // 1. DAFTAR URL SOURCE GOOGLE SHEETS
        const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
        const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
        const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";
        const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFIandJGLnlZMrwR-19m5hMA7E4E/export?format=csv&gid=0";

        // Fetch data paralel dengan timeout aman 8 detik
        const configTimeout = { timeout: 8000 };
        const [resS, resR, resK, resP] = await Promise.all([
            axios.get(urlS, configTimeout).catch(err => { console.error("Error Stok:", err.message); return { data: "" }; }),
            axios.get(urlR, configTimeout).catch(err => { console.error("Error Ship:", err.message); return { data: "" }; }),
            axios.get(urlK, configTimeout).catch(err => { console.error("Error Kas:", err.message); return { data: "" }; }),
            axios.get(urlP, configTimeout).catch(err => { console.error("Error Pack:", err.message); return { data: "" }; })
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

        // 5. PARSING DATA TAB PACKAGING (MURNI DINAMIS OTOMATIS)
        let packHeaders = []; // Tempat menyimpan nama-nama ukuran varian (100G, 200G, dll) secara otomatis
        let packagingAll = [];
        let lastUpdatePack = "-";
        
        if (resP.data && resP.data.trim() !== "") {
            const linesP = resP.data.split(/\r?\n/).filter(line => line.trim() !== "");
            
            // Ambil text last update dari baris ke-2 (index 1) kolom H (index 7)
            if (linesP.length > 1) {
                const barisSample = splitCSV(linesP[1]);
                if (barisSample[7] && barisSample[7].trim() !== "") {
                    lastUpdatePack = barisSample[7].trim();
                }
            }

            // AMBIL HEADER DINAMIS: Baca baris pertama (Index 0) untuk tahu ukuran varian apa saja yang ada di sheet
            if (linesP.length > 0) {
                const rawHeaders = splitCSV(linesP[0]);
                // Ambil kolom setelah PRODUCT (kolom index 1 sampai sebelum kolom LAST UPDATE/kolom ke-7)
                for (let i = 1; i < rawHeaders.length; i++) {
                    if (!rawHeaders[i] || rawHeaders[i].trim() === "" || rawHeaders[i].toLowerCase().includes("update")) break;
                    packHeaders.push(rawHeaders[i].trim().toUpperCase());
                }
            }

            // Ambil nilai per baris produk secara dinamis menyesuaikan header yang terbaca
            for (let i = 1; i < linesP.length; i++) {
                const c = splitCSV(linesP[i]);
                if (!c[0] || c[0].trim() === "" || c[0].toLowerCase() === "product") continue;
                
                let varianData = {};
                packHeaders.forEach((header, idx) => {
                    let nilaiSel = c[idx + 1]; // Geser +1 karena index 0 adalah nama Product
                    varianData[header] = (nilaiSel && nilaiSel.trim() !== "") ? nilaiSel.trim() : "-";
                });

                packagingAll.push({
                    nama: c[0].trim(),
                    varian: varianData // Menyimpan data varian berupa key-value dinamis
                });
            }
        }

        if (lastUpdatePack === "-") {
            lastUpdatePack = "Belum Diupdate";
        }

        // 6. RENDER DATA KE VIEW INDEX
        res.render('index', { 
            stocks, 
            shippingAll, 
            kasAll, 
            packHeaders, // Ditambahkan agar frontend bisa menggambar kolom otomatis
            packagingAll, 
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
