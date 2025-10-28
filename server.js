const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  if (waitingUser) {
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { partnerId: waitingUser.id });
    waitingUser.emit("matched", { partnerId: socket.id });

    waitingUser = null;
  } else {
    waitingUser = socket;
  }

  socket.on("signal", (data) => {
    if (socket.partner) socket.partner.emit("signal", data);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket) waitingUser = null;
    if (socket.partner) socket.partner.emit("partner-disconnected");
  });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));
