require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    console.log('Kode QR diterima.', qr);
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('Client terautentikasi.');
});

async function callLaravelReminder() {
    try {
        const response = await fetch(process.env.API_ENDPOINT, {
            method: 'GET',
            headers: {
                'X-CRON-TOKEN': process.env.X_CRON_TOKEN,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        // === MOTOR ===
        for (const motor of data.motor) {
            if (!motor.karyawan || !motor.karyawan.no_hp) continue;

            const message = buildMessage('motor', motor);
            await sendWhatsApp(motor.karyawan.no_hp, message);
        }

        // === BTS ===
        for (const bts of data.bts) {
            if (!bts.telepon) continue;

            const message = buildMessage('bts', bts);
            await sendWhatsApp(bts.telepon, message);
        }

        // === DOMAIN ===
        for (const domain of data.domain) {
            if (!domain.telepon) continue;

            const message = buildMessage('domain', domain);
            await sendWhatsApp(domain.telepon, message);
        }

        // console.log(data);
    } catch (error) {
        console.error('[REMINDER ERROR]', error.message);
    }
}

client.on('ready', () => {
    console.log('Client siap.');

    process.env.TZ = 'Asia/Jakarta';

    cron.schedule('20 11 * * *', () => {
        console.log('⏰ Reminder jam 12:00');
        callLaravelReminder();
    });

    cron.schedule('0 13 * * *', () => {
        console.log('⏰ Reminder jam 13:00');
        callLaravelReminder();
    });
});

function buildMessage(type, item) {
    let statusText = '';

    switch (item.expired_status) {
        case 'soon':
            statusText = 'akan jatuh tempo dalam waktu dekat';
            break;
        case 'today':
            statusText = 'jatuh tempo hari ini';
            break;
        case 'passed':
            statusText = 'sudah lewat jatuh tempo';
            break;
    }

    if (type === 'motor') {
        return `🔔 *Reminder Pajak Motor*

Motor: *${item.nama_motor}*
Plat: *${item.plat_nomor}*
Status: *${statusText}*

Mohon segera ditindaklanjuti.`;
    }

    if (type === 'bts') {
        return `🔔 *Reminder BTS*

Nama BTS: *${item.nama_bts}*
Pemilik: *${item.nama_user}*
Status: *${statusText}*

Mohon segera ditindaklanjuti.`;
    }

    if (type === 'domain') {
        return `🔔 *Reminder Domain*
        
Nama Domain: *${item.nama_domain}*
Nama Perusahaan: *${item.nama_perusahaan}*
Status: *${statusText}*

Mohon segera ditindaklanjuti.`;
    }
}

async function sendWhatsApp(phone, message) {
    const chatId = phone.replace(/^0/, '62') + '@c.us';
    await client.sendMessage(chatId, message);
}



client.initialize();