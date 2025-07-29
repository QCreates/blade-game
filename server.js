const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*", // In production, specify your domain
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('./')); // Serve your HTML files

// Game state
const rooms = new Map();
const players = new Map(); // socketId -> player info
const battleRooms = new Map(); // roomId -> battle state

// Room management functions
function createRoom(roomData, creatorSocketId) {
  const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  const room = {
    id: roomId,
    name: roomData.name,
    type: roomData.type, // 'practice' or 'wager'
    wagerAmount: roomData.wagerAmount || null,
    hasPassword: !!roomData.password,
    password: roomData.password || null,
    maxPlayers: 2,
    players: [],
    creator: creatorSocketId,
    status: 'waiting', // 'waiting', 'starting', 'active', 'finished'
    createdAt: new Date().toISOString()
  };
  
  rooms.set(roomId, room);
  return room;
}

function addPlayerToRoom(roomId, socketId, password = null) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'Room not found' };
  
  if (room.players.length >= room.maxPlayers) {
    return { success: false, error: 'Room is full' };
  }
  
  if (room.hasPassword && room.password !== password) {
    return { success: false, error: 'Invalid password' };
  }
  
  if (room.players.includes(socketId)) {
    return { success: false, error: 'Already in room' };
  }
  
  room.players.push(socketId);
  
  // Update player info
  if (players.has(socketId)) {
    players.get(socketId).currentRoom = roomId;
  }
  
  return { success: true, room };
}

function removePlayerFromRoom(socketId) {
  const playerInfo = players.get(socketId);
  if (!playerInfo || !playerInfo.currentRoom) return;
  
  const room = rooms.get(playerInfo.currentRoom);
  if (!room) return;
  
  room.players = room.players.filter(id => id !== socketId);
  playerInfo.currentRoom = null;
  
  // If room is empty or creator left, delete room
  if (room.players.length === 0 || room.creator === socketId) {
    rooms.delete(room.id);
  }
}

function getRoomsList() {
  return Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    type: room.type,
    wagerAmount: room.wagerAmount,
    hasPassword: room.hasPassword,
    players: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    createdAt: room.createdAt
  }));
}

// Utility function to clean up battle room
function cleanupBattleRoom(battleRoomId, reason = 'unknown') {
  const battleRoom = battleRooms.get(battleRoomId);
  if (battleRoom) {
    console.log(`Cleaning up battle room ${battleRoomId} - reason: ${reason}`);
    
    // Notify any remaining players
    io.to(battleRoomId).emit('battle-cleanup', {
      message: 'Battle room is being cleaned up',
      reason: reason
    });
    
    // Remove all sockets from the room
    const room = io.sockets.adapter.rooms.get(battleRoomId);
    if (room) {
      for (const socketId of room) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.leave(battleRoomId);
        }
      }
    }
    
    battleRooms.delete(battleRoomId);
    console.log(`Battle room ${battleRoomId} cleaned up successfully`);
    return true;
  }
  return false;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Initialize player
  players.set(socket.id, {
    id: socket.id,
    currentRoom: null,
    connectedAt: new Date().toISOString()
  });
  
  // Send current rooms list to new player
  socket.emit('rooms-update', getRoomsList());
  socket.emit('connection-status', { connected: true, playerId: socket.id });
  
  // Handle room creation
  socket.on('create-room', (roomData) => {
    try {
      console.log(`Player ${socket.id} creating room:`, roomData);
      
      // Validation
      if (!roomData.name || roomData.name.trim().length === 0) {
        socket.emit('error', { message: 'Room name is required' });
        return;
      }
      
      if (roomData.type === 'wager' && !roomData.wagerAmount) {
        socket.emit('error', { message: 'Wager amount is required for wager matches' });
        return;
      }
      
      const room = createRoom(roomData, socket.id);
      
      // Add creator to room
      const joinResult = addPlayerToRoom(room.id, socket.id);
      if (!joinResult.success) {
        socket.emit('error', { message: joinResult.error });
        return;
      }
      
      // Join socket room for real-time updates
      socket.join(room.id);
      
      // Notify all clients of new room
      io.emit('rooms-update', getRoomsList());
      
      socket.emit('room-created', { 
        roomId: room.id, 
        room: {
          ...room,
          players: room.players.length  // Convert array to count
        },
        message: `Room "${room.name}" created successfully!` 
      });
      
      console.log(`Room created: ${room.id} by ${socket.id}`);
      
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });
  
  // Handle joining room
  socket.on('join-room', (data) => {
    try {
      console.log(`Player ${socket.id} joining room:`, data);
      
      const { roomId, password } = data;
      const joinResult = addPlayerToRoom(roomId, socket.id, password);
      
      if (!joinResult.success) {
        socket.emit('error', { message: joinResult.error });
        return;
      }
      
      // Join socket room
      socket.join(roomId);
      
      // Notify room members
      socket.to(roomId).emit('player-joined', { 
        playerId: socket.id,
        room: {
          ...joinResult.room,
          players: joinResult.room.players.length  // Convert array to count
        }
      });
      
      socket.emit('room-joined', { 
        roomId: roomId,
        room: {
          ...joinResult.room,
          players: joinResult.room.players.length  // Convert array to count
        },
        message: `Joined room "${joinResult.room.name}"` 
      });
      
      // Update rooms list for all clients
      io.emit('rooms-update', getRoomsList());
      
      // If room is full, notify players that match can start
      if (joinResult.room.players.length === joinResult.room.maxPlayers) {
        io.to(roomId).emit('room-full', { 
          room: {
            ...joinResult.room,
            players: joinResult.room.players.length  // Convert array to count
          },
          message: 'Room is full! Match can begin.' 
        });
      }
      
      console.log(`Player ${socket.id} joined room ${roomId}`);
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Handle leaving room
  socket.on('leave-room', () => {
    try {
      const playerInfo = players.get(socket.id);
      if (playerInfo && playerInfo.currentRoom) {
        const roomId = playerInfo.currentRoom;
        
        socket.leave(roomId);
        socket.to(roomId).emit('player-left', { playerId: socket.id });
        
        removePlayerFromRoom(socket.id);
        
        // Update rooms list
        io.emit('rooms-update', getRoomsList());
        
        socket.emit('room-left', { message: 'Left room successfully' });
        
        console.log(`Player ${socket.id} left room ${roomId}`);
      }
    } catch (error) {
      console.error('Error leaving room:', error);
      socket.emit('error', { message: 'Failed to leave room' });
    }
  });
  
  // Handle getting rooms list
  socket.on('get-rooms', () => {
    socket.emit('rooms-update', getRoomsList());
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Remove from room if in one
    removePlayerFromRoom(socket.id);
    
    // Clean up battle rooms - remove disconnected player and check if battle should end
    for (const [battleRoomId, battleRoom] of battleRooms.entries()) {
      const playerIndex = battleRoom.players.indexOf(socket.id);
      if (playerIndex !== -1) {
        console.log(`Removing disconnected player ${socket.id} from battle room ${battleRoomId}`);
        
        // Mark the slot as empty but don't remove entirely (for reconnection)
        battleRoom.players[playerIndex] = null;
        
        // Count remaining connected players
        const connectedSockets = Array.from(io.sockets.sockets.keys());
        const remainingPlayers = battleRoom.players.filter(playerId => 
          playerId && connectedSockets.includes(playerId)
        );
        
        // If no players remain, clean up the battle room after a delay
        if (remainingPlayers.length === 0) {
          console.log(`No players remaining in battle room ${battleRoomId}, scheduling cleanup`);
          setTimeout(() => {
            // Double-check if room is still empty
            const currentConnectedSockets = Array.from(io.sockets.sockets.keys());
            const currentPlayers = battleRoom.players.filter(playerId => 
              playerId && currentConnectedSockets.includes(playerId)
            );
            
            if (currentPlayers.length === 0) {
              cleanupBattleRoom(battleRoomId, 'all_players_disconnected');
            }
          }, 30000); // 30 second grace period for reconnection
        }
        
        // Notify remaining players about disconnection
        socket.to(battleRoomId).emit('player-disconnected', {
          playerId: socket.id,
          playerNumber: playerIndex + 1,
          message: `Player ${playerIndex + 1} disconnected`
        });
        
        break; // Player can only be in one battle room
      }
    }
    
    // Remove player
    players.delete(socket.id);
    
    // Update rooms list for remaining clients
    io.emit('rooms-update', getRoomsList());
  });
  
  // Handle battle start
  socket.on('start-battle', (data) => {
    try {
      const playerInfo = players.get(socket.id);
      if (!playerInfo || !playerInfo.currentRoom) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }
      
      const room = rooms.get(playerInfo.currentRoom);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      if (room.players.length < 2) {
        socket.emit('error', { message: 'Need 2 players to start battle' });
        return;
      }
      
      console.log(`Player ${socket.id} starting battle in room ${room.id}`);
      
      // Notify all players in the room to start battle
      io.to(room.id).emit('battle-starting', {
        roomId: room.id,
        message: 'Battle starting! Redirecting both players...',
        countdown: 3
      });
      
      // Create battle room
      const battleRoom = {
        id: room.id,
        players: [null, null], // Initialize empty slots instead of copying room.players
        gameState: {
          player1: { hp: 100, position: { x: 150, y: 250 }, rotation: 0 },
          player2: { hp: 100, position: { x: 750, y: 250 }, rotation: 0 },
          status: 'starting' // 'starting', 'active', 'finished'
        },
        createdAt: new Date().toISOString()
      };
      
      // Clean up any existing battle room with the same ID
      if (battleRooms.has(room.id)) {
        console.log(`Cleaning up existing battle room ${room.id}`);
        battleRooms.delete(room.id);
      }
      
      battleRooms.set(room.id, battleRoom);
      console.log(`Fresh battle room created: ${room.id} with empty player slots:`, battleRoom.players);
      
      // After a short delay, redirect all players
      setTimeout(() => {
        io.to(room.id).emit('battle-redirect', {
          url: '/battle.html',
          battleRoomId: room.id,
          roomData: {
            ...room,
            players: room.players.length
          }
        });
      }, 3000);
      
    } catch (error) {
      console.error('Error starting battle:', error);
      socket.emit('error', { message: 'Failed to start battle' });
    }
  });

  // Handle battle events
  socket.on('join-battle', (data) => {
    try {
      const { battleRoomId } = data;
      let battleRoom = battleRooms.get(battleRoomId);
      
      if (!battleRoom) {
        socket.emit('error', { message: 'Battle room not found' });
        return;
      }
      
      console.log(`Battle room ${battleRoomId} original players:`, battleRoom.players);
      console.log(`New socket ${socket.id} trying to join`);
      
      // Clean up disconnected players from battle room first
      const connectedSockets = Array.from(io.sockets.sockets.keys());
      battleRoom.players = battleRoom.players.filter(playerId => 
        playerId && connectedSockets.includes(playerId)
      );
      
      console.log(`Battle room ${battleRoomId} after cleanup:`, battleRoom.players);
      
      // Check if this socket is already in the battle room
      if (battleRoom.players.includes(socket.id)) {
        console.log(`Socket ${socket.id} already in battle room, finding existing player number`);
        const existingPlayerNumber = battleRoom.players.indexOf(socket.id) + 1;
        
        socket.join(battleRoomId);
        socket.emit('battle-joined', {
          battleRoomId: battleRoomId,
          playerNumber: existingPlayerNumber,
          gameState: battleRoom.gameState,
          message: `You are Player ${existingPlayerNumber} (reconnected)`
        });
        return;
      }
      
      // Assign player number based on available slots in players array
      let playerNumber;
      let assignedSlot = -1;
      
      // Find first available slot
      for (let i = 0; i < 2; i++) {
        if (!battleRoom.players[i] || !connectedSockets.includes(battleRoom.players[i])) {
          playerNumber = i + 1;
          assignedSlot = i;
          break;
        }
      }
      
      if (playerNumber === undefined) {
        socket.emit('error', { message: 'Battle room is full' });
        return;
      }
      
      // Assign player to the slot
      battleRoom.players[assignedSlot] = socket.id;
      
      // Join the battle room
      socket.join(battleRoomId);
      
      console.log(`Player ${socket.id} joined battle ${battleRoomId} as player ${playerNumber}`);
      console.log(`Updated battle room players:`, battleRoom.players);
      
      // Send initial battle state
      socket.emit('battle-joined', {
        battleRoomId: battleRoomId,
        playerNumber: playerNumber,
        gameState: battleRoom.gameState,
        message: `You are Player ${playerNumber}`
      });
      
      // Check if both players have joined (count non-null connected players)
      const activePlayers = battleRoom.players.filter(playerId => 
        playerId && connectedSockets.includes(playerId)
      );
      
      if (activePlayers.length === 2) {
        battleRoom.gameState.status = 'active';
        io.to(battleRoomId).emit('battle-ready', {
          message: 'Both players connected! Battle begins!',
          gameState: battleRoom.gameState
        });
      }
      
    } catch (error) {
      console.error('Error joining battle:', error);
      socket.emit('error', { message: 'Failed to join battle' });
    }
  });

  socket.on('battle-update', (data) => {
    try {
      const { battleRoomId, playerNumber, position, rotation, hp } = data;
      const battleRoom = battleRooms.get(battleRoomId);
      
      if (!battleRoom || !battleRoom.players.includes(socket.id)) {
        return; // Ignore invalid updates
      }
      
      // Update game state
      const playerKey = `player${playerNumber}`;
      if (battleRoom.gameState[playerKey]) {
        if (position) battleRoom.gameState[playerKey].position = position;
        if (rotation !== undefined) battleRoom.gameState[playerKey].rotation = rotation;
        if (hp !== undefined) battleRoom.gameState[playerKey].hp = hp;
      }
      
      // Broadcast to other player
      socket.to(battleRoomId).emit('battle-state-update', {
        playerNumber,
        position,
        rotation,
        hp
      });
      
    } catch (error) {
      console.error('Error updating battle:', error);
    }
  });

  socket.on('battle-action', (data) => {
    try {
      const { battleRoomId, action, damage, targetPlayer } = data;
      const battleRoom = battleRooms.get(battleRoomId);
      
      if (!battleRoom || !battleRoom.players.includes(socket.id)) {
        return;
      }
      
      console.log(`Battle action in ${battleRoomId}:`, action, 'damage:', damage, 'target:', targetPlayer);
      
      // Apply damage if specified
      if (damage && targetPlayer) {
        const targetKey = `player${targetPlayer}`;
        if (battleRoom.gameState[targetKey]) {
          battleRoom.gameState[targetKey].hp = Math.max(0, battleRoom.gameState[targetKey].hp - damage);
          
          // Check for winner
          if (battleRoom.gameState[targetKey].hp <= 0) {
            const winner = targetPlayer === 1 ? 2 : 1;
            battleRoom.gameState.status = 'finished';
            
            io.to(battleRoomId).emit('battle-ended', {
              winner: winner,
              message: `Player ${winner} wins!`,
              gameState: battleRoom.gameState
            });
            
            // Clean up battle room after delay using the utility function
            setTimeout(() => {
              cleanupBattleRoom(battleRoomId, 'battle_ended');
            }, 10000);
          }
        }
      }
      
      // Broadcast action to all players in battle
      io.to(battleRoomId).emit('battle-action-broadcast', {
        action,
        damage,
        targetPlayer,
        gameState: battleRoom.gameState
      });
      
    } catch (error) {
      console.error('Error handling battle action:', error);
    }
  });

  // Handle ping for connection testing
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Basic HTTP routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'lobby.html'));
});

app.get('/lobby', (req, res) => {
  res.sendFile(path.join(__dirname, 'lobby.html'));
});

app.get('/battle', (req, res) => {
  res.sendFile(path.join(__dirname, 'battle.html'));
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    rooms: rooms.size,
    players: players.size,
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 BladeBox server running on port ${PORT}`);
  console.log(`📊 Server status: http://localhost:${PORT}/status`);
  console.log(`🎮 Game lobby: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server shut down');
  });
}); 