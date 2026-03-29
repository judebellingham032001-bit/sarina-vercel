const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

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
        const urlS = "https://docs.google.com/spreadsheets/d/1xTVwqw9a3BMrmHEir9wQEidVxIgUhvCP_qj8jHY0u7w/export?format=csv&gid=0";
        const urlR = "https://docs.google.com/spreadsheets/d/16N1Jpc11GUJyKqpyEvueKx0ccroVJfG-s6yP3DxxyX4/export?format=csv&gid=0";
        const urlK = "https://docs.google.com/spreadsheets/d/1oT_uV104wNhTOmJjX_MOzvpkkX0_QAvMYOirsVFbTYo/export?format=csv&gid=0";

        const [resS, resR, resK] = await Promise.all([
            axios.get(urlS), axios.get(urlR), axios.get(urlK)
        ]);

        const linesS = resS.data.split(/\r?\n/);
        const lastUpdate = splitCSV(linesS[0])[0] || "-"; 

        const stocks = linesS.slice(13).map(l => {
            const c = splitCSV(l);
            let status = "TERSEDIA";
            if (parseFloat(c[1]) <= 0) status = "OUT OF STOCK";
            else if (parseFloat(c[1]) <= 2) status = "LOW";
            return { nama: c[0], qty: parseFloat(c[1]) || 0, display: c[3], statusTxt: status };
        }).filter(i => i.nama);

        const shippingAll = resR.data.split(/\r?\n/).slice(3).map(l => {
            const c = splitCSV(l);
            return { tgl: c[6], spx: c[7], jne: c[8], jnt: c[9], sd: c[10], tot: c[11] };
        }).filter(i => i.tgl && i.tgl !== "0");

        const linesK = resK.data.split(/\r?\n/);
        let tempDate = ""; 
        const kasAll = linesK.slice(5).map(l => {
            const c = splitCSV(l);
            if (c[0] && c[0].trim() !== "") tempDate = c[0];
            let linkBukti = (c[3] && c[3].toLowerCase().includes('http')) ? c[3].trim().replace(/^"|"$/g, '') : "";
            let mutasiRaw = "0";
            let tipe = "netral";
            if (c[4] && c[4] !== "0" && c[4] !== "-") { mutasiRaw = "-" + c[4]; tipe = "debet"; }
            else if (c[5] && c[5] !== "0" && c[5] !== "-") { mutasiRaw = c[5]; tipe = "kredit"; }

            return { 
                tgl: tempDate, kat: c[1], ket: c[2], mutasi: formatRP(mutasiRaw),
                tipeMutasi: tipe, saldo: formatRP(c[6]), bukti: linkBukti 
            };
        }).filter(t => t.kat && t.kat !== "Kategori" && t.kat !== "");

        let saldoTotalRaw = kasAll.length > 0 ? kasAll[kasAll.length - 1].saldo.replace(/[^\d-]/g, "") : "0";
        const isSaldoMinus = saldoTotalRaw.startsWith("-");

        res.render('index', { 
            stocks, shippingAll, kasAll, 
            saldoTotal: formatRP(saldoTotalRaw).replace('+', ''), 
            isSaldoMinus, lastUpdate 
        });
    } catch (e) {
        res.status(500).send("Gagal memuat data: " + e.message);
    }
});

module.exports = app;
