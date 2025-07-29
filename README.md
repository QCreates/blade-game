# BladeBox - Multiplayer Setup Guide

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
# Or for development with auto-restart:
npm run dev
```

### 3. Open the Game
- Server runs on `http://localhost:3000`
- Open `http://localhost:3000` in your browser
- Or directly open `lobby.html` (it will connect to localhost:3000)

## 🧪 Testing Multiplayer

### Test with Multiple Browser Tabs/Windows:
1. Open `http://localhost:3000` in 2+ browser tabs
2. Create a practice room in one tab
3. Join the room from another tab
4. See real-time updates!

### Test Room Features:
- **Create Practice Room**: No wager, just for testing
- **Create Wager Room**: With money amounts (mock for now)
- **Password Protection**: Test private rooms
- **Real-time Updates**: Watch rooms appear/disappear live

## 📊 Server Status
- Check server health: `http://localhost:3000/status`
- View active rooms and players count

## 🔧 Current Features
- ✅ Real-time lobby system
- ✅ Room creation (practice & wager)
- ✅ Password protection
- ✅ Live player count
- ✅ Connection status
- ✅ Error handling

## 🚧 Next Steps (Phase 2)
- [ ] Weapon synchronization
- [ ] Battle state sync
- [ ] Real-time physics
- [ ] Reconnection handling

## 🐛 Troubleshooting

### "Not connected to server" error:
1. Make sure server is running: `npm start`
2. Check console for connection errors
3. Verify server URL in lobby.html (line ~538)

### Rooms not updating:
1. Check browser console for WebSocket errors
2. Refresh the page
3. Restart the server

### Port already in use:
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
# Or use different port
PORT=3001 npm start
```

## 📝 Server API

### WebSocket Events

**Client → Server:**
- `create-room` - Create new room
- `join-room` - Join existing room  
- `leave-room` - Leave current room
- `get-rooms` - Request rooms list

**Server → Client:**
- `rooms-update` - Updated rooms list
- `room-created` - Room creation success
- `room-joined` - Successfully joined room
- `room-full` - Room is full, ready to start
- `player-joined` - Another player joined your room
- `player-left` - Player left your room
- `error` - Error message

## 🔒 Security Notes
- Passwords are stored in memory (not encrypted)
- CORS is open for development (`origin: "*"`)
- No authentication system yet
- Wager amounts are not validated

---

**Ready to test!** Start the server and open multiple browser tabs to see real-time multiplayer in action! 🎮 