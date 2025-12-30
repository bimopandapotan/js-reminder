require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ===============================
// Inisialisasi Express & Socket
// ===============================
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.SOCKET_ORIGIN,
        methods: ["GET", "POST"]
    }
});

// ===============================
// Inisialisasi WhatsApp Client
// ===============================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Helper delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===============================
// Socket.io Events
// ===============================
io.on('connection', (socket) => {
    console.log('🔌 Dashboard terhubung via socket');

    // Kirim status awal
    socket.emit('status', client.info ? 'Connected' : 'Disconnected');

    /**
     * ===============================
     * LOGOUT WHATSAPP (GANTI NOMOR)
     * ===============================
     */
    socket.on('logout-wa', async () => {
        console.log('⚠️ Logout WhatsApp diminta dari dashboard');

        try {
            io.emit('status', 'Logging Out');

            if (client.info) {
                await client.logout();
            }

            await client.destroy();
            await delay(2000);
            client.initialize();

            io.emit('status', 'Disconnected');
            console.log('✅ WhatsApp berhasil logout, QR baru siap');

        } catch (err) {
            console.error('❌ Gagal logout WA:', err.message);
            socket.emit('log', 'Logout WhatsApp gagal');
        }
    });
});

// ===============================
// WhatsApp Web.js Events
// ===============================
client.on('qr', (qr) => {
    console.log('📸 QR baru dikirim ke dashboard');

    io.emit('qr_code', qr);
    io.emit('status', 'Waiting for Scan');
});

client.on('authenticated', () => {
    console.log('🔐 WhatsApp terautentikasi');
    io.emit('status', 'Authenticated');
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client siap');
    io.emit('status', 'Connected');

    cron.schedule('50 10 * * *', () => {
        console.log('⏰ Cron Reminder 11:39');
        callLaravelReminder();
    });

    cron.schedule('0 13 * * *', () => {
        console.log('⏰ Cron Reminder 13:00');
        callLaravelReminder();
    });
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp terputus:', reason);
    io.emit('status', 'Disconnected');
    client.initialize();
});

// ===============================
// Reminder Logic
// ===============================
async function callLaravelReminder() {
    try {
        const response = await fetch(process.env.API_ENDPOINT, {
            method: 'GET',
            headers: {
                'X-CRON-TOKEN': process.env.X_CRON_TOKEN,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        const categories = [
            { items: data.motor, type: 'motor', phoneField: i => i.karyawan?.no_hp },
            { items: data.bts, type: 'bts', phoneField: i => i.telepon },
            { items: data.domain, type: 'domain', phoneField: i => i.telepon },
            { items: data.jenispembayaran, type: 'jenispembayaran', phoneField: i => i.telepon?.nomor_telepon },
            { items: data.reminder, type: 'reminder', phoneField: i => i.telepon?.nomor_telepon }
        ];

        for (const cat of categories) {
            if (!cat.items) continue;

            for (const item of cat.items) {
                const phone = cat.phoneField(item);
                if (!phone) continue;

                const message = buildMessage(cat.type, item);
                await sendWhatsApp(phone, message);
                await delay(2000);
            }
        }

    } catch (err) {
        console.error('[REMINDER ERROR]', err.message);
        io.emit('log', 'Error: ' + err.message);
    }
}

// ===============================
// Message Builder
// ===============================
function buildMessage(type, item) {
    let statusText = 'perlu perhatian';

    if (item.expired_status === 'soon') statusText = 'akan jatuh tempo dalam waktu dekat';
    if (item.expired_status === 'today') statusText = 'jatuh tempo hari ini';
    if (item.expired_status === 'passed') statusText = 'sudah lewat jatuh tempo';

    const header = `🔔 *REMINDER ${type.toUpperCase()}*`;
    const footer = `\nMohon segera ditindaklanjuti.\n_Terima kasih._`;

    if (type === 'motor')
        return `${header}\n\nMotor: *${item.nama_motor}*\nPlat: *${item.plat_nomor}*\nStatus: *${statusText}*${footer}`;

    if (type === 'bts')
        return `${header}\n\nNama BTS: *${item.nama_bts}*\nPemilik: *${item.nama_user}*\nStatus: *${statusText}*${footer}`;

    if (type === 'domain')
        return `${header}\n\nDomain: *${item.nama_domain}*\nPerusahaan: *${item.nama_perusahaan}*\nStatus: *${statusText}*${footer}`;

    if (type === 'jenispembayaran')
        return `${header}\n\nJenis: *${item.jenis_pembayaran}*\nStatus: *${statusText}*${footer}`;

    if (type === 'reminder')
        return `${header}\n\nNama: *${item.tentang_reminder}*\nKeterangan: *${item.keterangan}*\nTanggal: *${item.tanggal_reminder}*\nStatus: *${statusText}*${footer}`;
}

// ===============================
// Send WhatsApp Message
// ===============================
async function sendWhatsApp(phone, message) {
    try {
        let formattedPhone = phone.toString().replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '62' + formattedPhone.substring(1);
        }

        const chatId = formattedPhone + '@c.us';
        await client.sendMessage(chatId, message);

        console.log(`✅ Pesan terkirim ke ${formattedPhone}`);
        io.emit('log', `Pesan terkirim ke ${formattedPhone}`);

    } catch (err) {
        console.error(`❌ Gagal kirim ke ${phone}:`, err.message);
    }
}

// ===============================
// Start Client & Server
// ===============================
client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
});
