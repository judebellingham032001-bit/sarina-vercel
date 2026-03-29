const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

// SETTING KHUSUS VERCEL BIAR TAHU LOKASI FOLDER VIEWS
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
            return { nama: c[0], qty: parseFloat(c[1]) || 0, display: c[3] };
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
            return { tgl: tempDate, kat: c[1], ket: c[2], debet: c[4], kredit: c[5], saldo: c[6], bukti: c[7] };
        }).filter(t => t.kat && t.kat !== "Kategori");

        const saldoTotal = kasAll.length > 0 ? kasAll[kasAll.length - 1].saldo : "0";

        res.render('index', { stocks, shippingAll, kasAll, saldoTotal, lastUpdate });
    } catch (e) {
        res.status(500).send("Error koneksi data: " + e.message);
    }
});

// KHUSUS VERCEL: GAK PAKAI APP.LISTEN
module.exports = app;