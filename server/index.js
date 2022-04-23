const { createReadStream } = require("fs");
const restify = require("restify");
const { json, urlencoded } = require("body-parser");
const { Subject } = require("rxjs");

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

class Room {
  // Keeps the whole messages that where sent in this room
  _messages = [];

  // Keeps the unique userids that are in the room
  _users = new Set([]);

  // Observable of new messages sent to the room
  _$messages = new Subject();

  // Observable for the users that join the room
  _$newUsers = new Subject();

  // Observable for the users that leave the room
  _$exitUsers = new Subject();

  /**
   * Creates a new Room
   * @returns a new instance of Room
   */
  static createRoom() {
    return new Room();
  }

  /**
   * returns a reference to the messages observable to listen to new messages
   * sent to this room
   */
  get $messages() {
    return this._$messages.asObservable();
  }

  /**
   * Returns a reference to the newUsers observable to listen to new users added
   * to the room
   */
  get $newUsers() {
    return this._$newUsers.asObservable();
  }

  /**
   * Returns a reference to the exitUsers observable to listen to new users
   */
  get $exitUsers() {
    return this._$exitUsers.asObservable();
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
    this._$messages.next(msg);
  }

  /**
   * Removes a user from the room
   * @param {String} userId A user id
   */
  exit(userId) {
    this._users.delete(userId);
    this._$exitUsers.next(userId);
  }

  /**
   * Adds a user to this room
   * @param {String} userId the user id
   * @returns {undefined}
   */
  join(userId) {
    if (this._users.has(userId)) return;
    this._users.add(userId);
    this._$newUsers.next(userId);
  }
}
