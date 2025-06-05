const socket = io();
let localStream;
let peerConnections = {};
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let rotationAngle = 0;
let unreadMessages = 0;

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function startMeeting(roomId, email) {
  socket.emit('join-room', { roomId, email });

  // Get local media
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById('local-video').srcObject = localStream;

  socket.on('user-connected', async ({ id, email }) => {
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[id] = { peerConnection, email };
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { sdp: offer, target: id, roomId });

    const remoteVideo = document.createElement('video');
    remoteVideo.id = `video-${id}`;
    remoteVideo.autoplay = true;
    remoteVideo.className = 'watermark';
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.innerHTML = `<p>${email}</p>`;
    videoContainer.appendChild(remoteVideo);
    document.getElementById('participants').appendChild(videoContainer);

    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, target: id, roomId });
      }
    };
  });

  socket.on('offer', async (payload) => {
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[payload.callerId] = { peerConnection, email: payload.callerEmail };
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { sdp: answer, target: payload.callerId, roomId });

    const remoteVideo = document.createElement('video');
    remoteVideo.id = `video-${payload.callerId}`;
    remoteVideo.autoplay = true;
    remoteVideo.className = 'watermark';
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.innerHTML = `<p>${payload.callerEmail}</p>`;
    videoContainer.appendChild(remoteVideo);
    document.getElementById('participants').appendChild(videoContainer);

    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, target: payload.callerId, roomId });
      }
    };
  });

  socket.on('answer', async (payload) => {
    const peerConnection = peerConnections[payload.callerId].peerConnection;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  });

  socket.on('ice-candidate', async (payload) => {
    const peerConnection = peerConnections[payload.callerId].peerConnection;
    await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
  });

  socket.on('user-disconnected', (id) => {
    if (peerConnections[id]) {
      peerConnections[id].peerConnection.close();
      delete peerConnections[id];
      const video = document.getElementById(`video-${id}`);
      if (video) video.parentElement.remove();
    }
  });

  socket.on('chat-message', ({ email, message }) => {
    const chatContainer = document.getElementById('chat-container');
    const chatPanel = document.getElementById('chat-panel');
    const chatBadge = document.getElementById('chat-badge');
    const messageElement = document.createElement('p');
    messageElement.textContent = `${email}: ${message}`;
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (!chatPanel.classList.contains('active')) {
      unreadMessages++;
      chatBadge.textContent = unreadMessages;
      chatBadge.parentElement.classList.add('has-messages');
    }
  });
}

// Toggle video
function toggleVideo() {
  const enabled = localStream.getVideoTracks()[0].enabled;
  localStream.getVideoTracks()[0].enabled = !enabled;
  const btn = document.getElementById('video-btn');
  btn.classList.toggle('off', !enabled);
  btn.querySelector('i').classList.toggle('fa-video', enabled);
  btn.querySelector('i').classList.toggle('fa-video-slash', !enabled);
}

// Toggle audio
function toggleAudio() {
  const enabled = localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks()[0].enabled = !enabled;
  const btn = document.getElementById('audio-btn');
  btn.classList.toggle('off', !enabled);
  btn.querySelector('i').classList.toggle('fa-microphone', enabled);
  btn.querySelector('i').classList.toggle('fa-microphone-slash', !enabled);
}

// Rotate camera
function rotateCamera() {
  rotationAngle = (rotationAngle + 90) % 360;
  document.getElementById('local-video').style.transform = `rotate(${rotationAngle}deg)`;
}

// Share screen
async function shareScreen() {
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const screenTrack = screenStream.getVideoTracks()[0];
  Object.values(peerConnections).forEach(({ peerConnection }) => {
    const videoTrack = localStream.getVideoTracks()[0];
    peerConnection.getSenders().find(sender => sender.track.kind === 'video').replaceTrack(screenTrack);
  });
  document.getElementById('local-video').srcObject = screenStream;
  screenTrack.onended = () => {
    Object.values(peerConnections).forEach(({ peerConnection }) => {
      const videoTrack = localStream.getVideoTracks()[0];
      peerConnection.getSenders().find(sender => sender.track.kind === 'video').replaceTrack(videoTrack);
    });
    document.getElementById('local-video').srcObject = localStream;
  };
}

// Record meeting
function toggleRecording() {
  if (!isRecording) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1280;
    canvas.height = 720;
    const streams = [localStream, ...Object.values(peerConnections).map(p => p.peerConnection.getRemoteStreams()[0])].filter(s => s);
    let xOffset = 0;
    streams.forEach(stream => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.onloadedmetadata = () => {
        ctx.drawImage(video, xOffset, 0, canvas.width / streams.length, canvas.height);
        xOffset += canvas.width / streams.length;
      };
    });
    const canvasStream = canvas.captureStream();
    mediaRecorder = new MediaRecorder(canvasStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${new Date().toISOString()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      recordedChunks = [];
    };
    mediaRecorder.start();
    isRecording = true;
    document.getElementById('record-btn').classList.add('off');
  } else {
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('record-btn').classList.remove('off');
  }
}

// Hangup
function hangup() {
  localStream.getTracks().forEach(track => track.stop());
  Object.values(peerConnections).forEach(({ peerConnection }) => peerConnection.close());
  socket.disconnect();
  window.location.href = '/';
}

// Send chat message
function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (message) {
    socket.emit('chat-message', message);
    input.value = '';
  }
}

// Toggle chat panel
function toggleChat() {
  const chatPanel = document.getElementById('chat-panel');
  const chatBadge = document.getElementById('chat-badge');
  chatPanel.classList.toggle('active');
  if (chatPanel.classList.contains('active')) {
    unreadMessages = 0;
    chatBadge.textContent = '0';
    chatBadge.parentElement.classList.remove('has-messages');
  }
}