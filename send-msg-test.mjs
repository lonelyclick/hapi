import { io } from 'socket.io-client';

const socket = io('http://localhost:3006', {
    auth: { token: 'rDhnX0JCPIki0s6t1kNsHJkSLCvpAEt3wNCb_dkEyOc:default' }
});

socket.on('connect', () => {
    console.log('Connected, socket id:', socket.id);
    
    socket.emit('send-message', {
        sessionId: '03eba215-ec44-400c-8879-2666e9c32f9d',
        text: 'hi'
    }, (response) => {
        console.log('Response:', JSON.stringify(response));
        setTimeout(() => process.exit(0), 500);
    });
});

socket.on('connect_error', (err) => {
    console.error('Connect error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('Timeout - no response');
    process.exit(1);
}, 10000);
