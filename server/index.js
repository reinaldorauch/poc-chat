const { createReadStream } = require("fs");
const restify = require("restify");
const { json, urlencoded } = require("body-parser");
const { Subject } = require("rxjs");

const server = restify.createServer();

const rooms = {};

server.use(json());
server.use(urlencoded({ extended: true }));
server.use(restify.plugins.queryParser());

server.get("/", (_, res) => {
  res.setHeader("Content-Type", "text/html");
  createReadStream(__dirname + "/../front/index.html").pipe(res);
});

server.get("/chat/:room", (req, res, next) => {
  let { room } = req.params;
  const { userId } = req.query;

  if (!room || !userId) {
    res.status(400);
    res.json({ error: "room or userId not defined" });
    return;
  }

  if (!rooms[room]) {
    rooms[room] = createRoom();
  }

  const roomName = room;
  room = rooms[room];

  room.join(userId);

  res.setHeader("Content-Type", "text/event-stream");
  sendCurrentUsers(res, room);

  room.$messages.subscribe((newMessage) => sendNewMessage(res, newMessage));
  room.$newUsers.subscribe((user) => sendNewUserMessage(res, user));
  room.$exitUsers.subscribe((user) => sendExitUserMessage(res, user));

  req.once("close", () => {
    room.exit(userId);
    if (room.empty) {
      rooms[roomName] = undefined;
      delete rooms[roomName];
    }
  });

  sendChatConnected(res);
});

server.post("/chat/:room", (req, res, next) => {
  const { room } = req.params;
  const msg = req.body;

  if (!room || !msg) {
    res.status(400);
    res.json({ error: "room or message not defined" });
    return next();
  }

  if (!rooms[room]) {
    res.status(404);
    res.json({ error: "room not found" });
    return next();
  }

  rooms[room].addMessage(msg);
  res.status(201);
  res.end();
  next();
});

const instance = server.listen(8080, () => {
  console.log("Server listening at", instance.address());
});

function sendCurrentUsers(res, room) {
  res.write(
    "event: current-users\ndata: " + JSON.stringify(room.users) + "\n\n"
  );
}

function sendChatConnected(res) {
  res.write("event: chat-connected\ndata:\n\n");
}

function sendNewMessage(req, msg) {
  req.write("event: chat-message\ndata: " + JSON.stringify(msg) + "\n\n");
}

function sendNewUserMessage(req, user) {
  req.write("event: user-enter\ndata: " + JSON.stringify({ user }) + "\n\n");
}

function sendExitUserMessage(req, user) {
  req.write("event: user-exits\ndata: " + JSON.stringify({ user }) + "\n\n");
}

function createRoom() {
  return new Room();
}

class Room {
  _messages = [];
  _users = new Set([]);
  _$messages = new Subject();
  _$newUsers = new Subject();
  _$exitUsers = new Subject();

  get $messages() {
    return this._$messages.asObservable();
  }

  get $newUsers() {
    return this._$newUsers.asObservable();
  }

  get $exitUsers() {
    return this._$exitUsers.asObservable();
  }

  get messages() {
    return this._messages;
  }

  get users() {
    return Array.from(this._users);
  }

  get empty() {
    return this._users.length === 0;
  }

  addMessage(msg) {
    this._messages.push(msg);
    this._$messages.next(msg);
  }

  exit(userId) {
    this._users.delete(userId);
    this._$exitUsers.next(userId);
  }

  join(userId) {
    if (this._users.has(userId)) return;
    this._users.add(userId);
    this._$newUsers.next(userId);
  }
}
