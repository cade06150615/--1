const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// 連接到 MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/friend-chat-room', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// 定義 MongoDB Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    inviteCode: { type: String, unique: true }
});

const messageSchema = new mongoose.Schema({
    user: { type: String, required: true },
    text: { type: String, required: true },
    time: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// 提供靜態檔案
app.use(express.static(path.join(__dirname, '../public')));

// 生成隨機邀請碼
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Socket.IO 事件處理
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('login', async ({ username, inviteCode }, callback) => {
        try {
            // 檢查邀請碼
            if (inviteCode) {
                const inviter = await User.findOne({ inviteCode });
                if (!inviter) {
                    return callback({ error: '邀請碼無效' });
                }
            }

            // 檢查用戶是否存在
            let user = await User.findOne({ name: username });
            if (!user) {
                const newInviteCode = generateInviteCode();
                user = new User({ name: username, inviteCode: newInviteCode });
                await user.save();
            }

            socket.user = user;
            callback({
                user: { name: user.name, inviteCode: user.inviteCode },
                inviter: inviteCode ? (await User.findOne({ inviteCode })).name : null
            });

            // 廣播用戶加入訊息
            io.emit('message', {
                user: '系統',
                text: `歡迎 ${username} 加入聊天室！`,
                time: new Date()
            });
        } catch (err) {
            console.error('Login error:', err);
            callback({ error: '登入失敗，請稍後再試' });
        }
    });

    socket.on('sendMessage', async ({ user, text }) => {
        try {
            const message = new Message({ user, text });
            await message.save();
            io.emit('message', { user, text, time: message.time });
        } catch (err) {
            console.error('Message save error:', err);
        }
    });

    socket.on('loadMessages', async () => {
        try {
            const messages = await Message.find().sort({ time: 1 }).limit(100);
            socket.emit('loadMessages', messages);
        } catch (err) {
            console.error('Load messages error:', err);
        }
    });

    socket.on('getInviteCode', async (callback) => {
        try {
            callback(socket.user.inviteCode);
        } catch (err) {
            console.error('Get invite code error:', err);
            callback('錯誤');
        }
    });

    socket.on('logout', () => {
        if (socket.user) {
            io.emit('message', {
                user: '系統',
                text: `${socket.user.name} 已離開聊天室`,
                time: new Date()
            });
            socket.user = null;
        }
    });

    socket.on('disconnect', () => {
        if (socket.user) {
            io.emit('message', {
                user: '系統',
                text: `${socket.user.name} 已離開聊天室`,
                time: new Date()
            });
        }
        console.log('A user disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
