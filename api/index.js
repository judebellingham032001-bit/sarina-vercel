// ==========================================
// WAJIB FULL SCRIPT - BACKEND EXPRESS (VERSI AWAL STATIS)
// ==========================================

const express = require('express');
const axios = require('axios');
const app = express.Router(); // Kembali ke router bawaan asli kamu

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
    let angka = Math.abs(parseInt(bersih.replace(/[^0-9-]/g, '') || '0'));
    let formatted = "Rp " + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return isMinus ? "-" + formatted : "+ " + formatted;
}

app.get('/', async (req, res) => {
    try {
        const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
        const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
        const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";
        
        // Sesuai link asli dari kamu, huruf I besar (FIand) agar tidak Error 404
        const urlP = "https://docs.google.com/spreadsheets/d/1CmfqkuK2w9GDuohbFIandJGLnlZMrwR-19m5hMA7E4E/export?format=csv"; 

        const [resS, resR, resK, resP] = await Promise.all([
            axios.get(urlS).catch(() => ({ data: "" })),
            axios.get(urlR).catch(() => ({ data: "" })),
            axios.get(urlK).catch(() => ({ data: "" })),
            axios.get(urlP).catch(() => ({ data: "" }))
        ]);

        // Parsing Stok
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

        // Parsing Shipping
        let shippingAll = [];
        if (resR.data) {
            shippingAll = resR.data.split(/\r?\n/).slice(3).map(l => {
                const c = splitCSV(l);
                return { tgl: c[6] || "", spx: c[7] || "0", jne: c[8] || "0", jnt: c[9] || "0", sd: c[10] || "0", tot: c[11] || "0" };
            }).filter(i => i.tgl && i.tgl !== "0");
        }

        // Parsing Kas
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

                return { tgl: tempDate, kat: c[1] || "", ket: c[2] || "", mutasi: formatRP(mutasiRaw), tipeMutasi: tipe, saldo: formatRP(c[6] || "0"), bukti: linkBukti };
            }).filter(t => t.kat && t.kat !== "Kategori" && t.kat !== "");

            if (kasAll.length > 0) {
                saldoTotalRaw = kasAll[kasAll.length - 1].saldo.replace(/[^\d-]/g, "");
                isSaldoMinus = saldoTotalRaw.startsWith("-");
            }
        }

        // Parsing Packaging (VERSI AWAL STATIS - PAKAI ARRAY BIASA)
        let packagingAll = [];
        if (resP.data) {
            const linesP = resP.data.split(/\r?\n/);
            packagingAll = linesP.slice(2).map(l => {
                const c = splitCSV(l);
                return {
                    nama: c[0] || "",
                    u100: c[1] || "-", u200: c[2] || "-", u250: c[3] || "-", u350: c[4] || "-",
                    u400: c[5] || "-", u500: c[6] || "-", u1000: c[7] || "-"
                };
            }).filter(p => p.nama);
        }

        res.render('index', { 
            stocks, shippingAll, kasAll, packagingAll, 
            saldoTotal: formatRP(saldoTotalRaw).replace('+', ''), isSaldoMinus, lastUpdate
        });
    } catch (e) {
        res.status(500).send("Gagal memuat data: " + e.message);
    }
});

module.exports = app;
