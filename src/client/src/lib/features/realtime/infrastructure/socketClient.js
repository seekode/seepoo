import { writable } from 'svelte/store';
import { io } from 'socket.io-client';

export const connected = writable(false);
export const architecture = writable({
  language: 'auto',
  availableLanguages: [],
  classes: [],
  draft: {},
  errors: []
});
export const vmState = writable({
  currentStep: -1,
  totalSteps: 0,
  snapshot: null
});

let socketInstance = null;

export function getSocket() {
  if (!socketInstance && typeof window !== 'undefined') {
    socketInstance = io();
    connected.set(socketInstance.connected);

    socketInstance.on('connect', () => connected.set(true));
    socketInstance.on('disconnect', () => connected.set(false));
    socketInstance.on('architecture:updated', (data) => architecture.set(data));
    socketInstance.on('vm:state', (data) => vmState.set(data));
  }
  return socketInstance;
}

export function selectLanguage(language) {
  const socket = getSocket();
  if (!socket) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    socket.emit('language:select', { language }, (ack) => resolve(ack));
  });
}

export function saveDraft(draftPatch) {
  const socket = getSocket();
  if (!socket) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    socket.emit('draft:save', draftPatch, (ack) => resolve(ack));
  });
}

export function instantiateObject(className, label, args, position) {
  const socket = getSocket();
  if (!socket) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    socket.emit('vm:instantiate', { className, label, args, position }, (ack) => resolve(ack));
  });
}

export function executeObjectMethod(instanceId, methodName, args) {
  const socket = getSocket();
  if (!socket) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    socket.emit('vm:execute', { instanceId, methodName, args }, (ack) => resolve(ack));
  });
}

export function timeTravelToStep(targetStep) {
  const socket = getSocket();
  if (!socket) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    socket.emit('vm:timetravel', { targetStep }, (ack) => resolve(ack));
  });
}
