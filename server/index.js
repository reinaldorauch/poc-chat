const { createReadStream } = require("fs");
const restify = require("restify");
const { json, urlencoded } = require("body-parser");
const EventEmitter = require("events");

// Creates a restify server
const server = restify.createServer();

// Initializes the room storage as a hash map of Room objects that maintain the
// the client connections
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

  // Validating the request
  if (!room || !userId) {
    res.status(400);
    res.json({ error: "room or userId not defined" });
    return;
  }

  if (!rooms[room]) {
    rooms[room] = Room.createRoom();
  }

  const roomName = room;
  room = rooms[room];

  room.join(userId);

  // Defining the request as event stream
  res.setHeader("Content-Type", "text/event-stream");

  sendCurrentUsers(res, room);

  // Initializing listeners
  const messageListener = (newMessage) => sendNewMessage(res, newMessage);
  const newUserListener = (user) => sendNewUserMessage(res, user);
  const exitUserListener = (user) => sendExitUserMessage(res, user);

  room.on(Room.events.NewMessage, messageListener);
  room.on(Room.events.NewUser, newUserListener);
  room.on(Room.events.ExitUser, exitUserListener);

  req.once("close", () => {
    room.exit(userId);

    // As we are using EventEmitter, we need to remove listeners to prevent
    // memory leaks
    room.off(Room.events.NewMessage, messageListener);
    room.off(Room.events.NewUser, newUserListener);
    room.off(Room.events.ExitUser, exitUserListener);

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

class Room extends EventEmitter {
  /**
   * Tracks events of the Room Class
   */
  static events = {
    NewMessage: "new-message",
    NewUser: "new-user",
    ExitUser: "exit-user",
  };

  // Keeps the whole messages that where sent in this room
  _messages = [];

  // Keeps the unique userids that are in the room
  _users = new Set([]);

  /**
   * Creates a new Room
   * @returns a new instance of Room
   */
  static createRoom() {
    return new Room();
  }

  /**
   * Returns all the messages sent in this room
   */
  get messages() {
    return this._messages;
  }

  /**
   * returns a list of all users currently in the room
   */
  get users() {
    return Array.from(this._users);
  }

  /**
   * says if the room is currently empty or not
   */
  get empty() {
    return this._users.length === 0;
  }

  /**
   * Send a new message to this room
   * @param {String} msg A new message
   */
  addMessage(msg) {
    this._messages.push(msg);
    this.emit(Room.events.NewMessage, msg);
  }

  /**
   * Removes a user from the room
   * @param {String} userId A user id
   */
  exit(userId) {
    this._users.delete(userId);
    this.emit(Room.events.ExitUser, userId);
  }

  /**
   * Adds a user to this room
   * @param {String} userId the user id
   * @returns {undefined}
   */
  join(userId) {
    if (this._users.has(userId)) return;
    this._users.add(userId);
    this.emit(Room.events.NewUser, userId);
  }
}
