// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static("public"));

let waiting = null;
let pairs = {};
let readyUsers = new Set();

io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("ready", () => {
        readyUsers.add(socket.id);
        console.log(`✅ ${socket.id} is ready`);
        
        if (!waiting) {
            waiting = socket.id;
            console.log(`⏳ Socket ${socket.id} is waiting for partner`);
        } else if (waiting !== socket.id && readyUsers.has(waiting)) {
            const partnerId = waiting;
            waiting = null;
            pairs[socket.id] = partnerId;
            pairs[partnerId] = socket.id;

            console.log(`🎯 Paired: ${socket.id} <--> ${partnerId}`);
            
            // Partner pertama jadi initiator
            io.to(partnerId).emit("partner-found", { 
                partnerId: socket.id, 
                initiator: true 
            });
            io.to(socket.id).emit("partner-found", { 
                partnerId: partnerId, 
                initiator: false 
            });
        }
    });

    socket.on("signal", (data) => {
        const partnerId = pairs[socket.id];
        if (partnerId) {
            console.log(`📨 Signal ${data.type} from ${socket.id} to ${partnerId}`);
            io.to(partnerId).emit("signal", data);
        } else {
            console.log(`⚠️  Signal ${data.type} from ${socket.id} but no partner found`);
        }
    });

    socket.on("next", () => {
        console.log(`${socket.id} requested next`);
        const partnerId = pairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit("partner-disconnected");
            delete pairs[partnerId];
            if (waiting === partnerId) waiting = null;
            readyUsers.delete(partnerId); // Remove partner from ready
        }
        delete pairs[socket.id];
        if (waiting === socket.id) waiting = null;
        readyUsers.delete(socket.id);
    });

    socket.on("disconnect", () => {
        const partnerId = pairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit("partner-disconnected");
            delete pairs[partnerId];
        }
        if (waiting === socket.id) waiting = null;
        delete pairs[socket.id];
        readyUsers.delete(socket.id);
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));