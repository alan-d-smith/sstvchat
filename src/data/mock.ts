import { ME } from '../types';
import type { Chat, Message, Person } from '../types';

export const people: Person[] = [
  { id: 'beatriz', name: 'Beatriz M', seed: 11, color: '#00C67F' },
  { id: 'julie', name: '💎Julie💎', seed: 12, color: '#A05DCD' },
  { id: 'sophie', name: 'Sophie', seed: 13, color: '#0FADFF' },
  { id: 'ben', name: 'Ben', seed: 14, color: '#E83E6B' },
  { id: 'jen', name: 'Jen', seed: 15, color: '#3CB371' },
  { id: 'moe', name: 'Moe S', seed: 17, color: '#0FADFF', badge: '😊' },
  { id: 'andy', name: 'Andy G', seed: 18, color: '#F23C57' },
  { id: 'callum', name: 'Callum B', seed: 19, color: '#3CB371' },
  { id: 'jess', name: 'Jess Alan', seed: 20, color: '#A05DCD' },
  { id: 'priya', name: 'Priya N', seed: 21, color: '#0FADFF' },
  { id: 'tomasz', name: 'Tomasz W', seed: 22, color: '#E83E6B' },
  { id: 'imogen', name: 'Imogen Rae', seed: 23, color: '#3CB371' },
  { id: 'dara', name: 'Dara K', seed: 24, color: '#A05DCD' },
  { id: 'alexandria', name: 'Alexandria Montgomery-Featherstone', seed: 25, color: '#0FADFF' },
];

const roomiesThread: Message[] = [
  { id: 'r1', senderId: 'sophie', type: 'text', text: 'omg almost missed my flight' },
  { id: 'r2', senderId: 'sophie', type: 'text', text: 'I was running for my life 💀' },
  { id: 'r3', senderId: ME, type: 'emoji', text: '😅' },
  { id: 'r4', senderId: 'sophie', type: 'text', text: 'The gates were so far apart and this airport is a MAZE.' },
  { id: 'r5', senderId: 'sophie', type: 'text', text: 'So out of breath! 9 minutes to spare!' },
  {
    id: 'r6', senderId: 'ben', type: 'quote',
    quoted: { senderId: 'sophie', text: 'omg almost missed my flight', time: '4:37PM' },
    text: 'So glad you made it.',
  },
  { id: 'r7', senderId: 'sophie', type: 'text', text: 'Catch ya later. Home in a few.' },
  { id: 'r8', senderId: 'sophie', type: 'sticker', text: '👍' },
];

export const chats: Chat[] = [
  {
    id: 'beatriz', title: 'Beatriz M', isGroup: false, memberIds: ['beatriz'],
    status: { kind: 'receiving', medium: 'snap', progress: 0.62 },
    hasIncomingSnap: true,
    messages: [{ id: 'b1', senderId: 'beatriz', type: 'snap', opened: false }],
  },
  {
    id: 'julie', title: '💎Julie💎', isGroup: false, memberIds: ['julie'],
    status: { kind: 'new-snap', medium: 'snap', time: '16m', streak: 29 },
    hasIncomingSnap: true,
    messages: [{ id: 'j1', senderId: 'julie', type: 'snap', opened: false }],
  },
  {
    id: 'roomies', title: 'Roomies', isGroup: true, memberIds: ['sophie', 'ben', 'jen', ME],
    status: { kind: 'opened', medium: 'chat', time: '1h' },
    messages: roomiesThread,
  },
  {
    id: 'starfish', title: 'Starfish Squad ✨', isGroup: true, memberIds: ['jen', 'ben', 'priya', ME],
    status: { kind: 'new-chat', medium: 'chat', time: '16m' },
    messages: [{ id: 's1', senderId: 'priya', type: 'text', text: 'who is bringing snacks Saturday?' }],
  },
  {
    id: 'moe', title: 'Moe S', isGroup: false, memberIds: ['moe'],
    status: { kind: 'delivered', medium: 'snap', time: '25m', streak: 29 },
    messages: [{ id: 'm1', senderId: ME, type: 'snap', opened: false }],
  },
  {
    id: 'andy', title: 'Andy G', isGroup: false, memberIds: ['andy'],
    status: { kind: 'screenshot', medium: 'chat', time: '1h' },
    messages: [{ id: 'a1', senderId: 'andy', type: 'text', text: 'ok that one was good' }],
  },
  {
    id: 'callum', title: 'Callum B', isGroup: false, memberIds: ['callum'],
    status: { kind: 'opened', medium: 'snap', time: '1h' },
    messages: [{ id: 'c1', senderId: ME, type: 'snap', opened: true }],
  },
  {
    id: 'jess', title: 'Jess Alan', isGroup: false, memberIds: ['jess'],
    status: { kind: 'opened', medium: 'chat', time: '1h' },
    messages: [{ id: 'je1', senderId: ME, type: 'text', text: 'see you at 7' }],
  },
  {
    id: 'priya', title: 'Priya N', isGroup: false, memberIds: ['priya'],
    status: { kind: 'received', medium: 'snap', time: '2h' },
    messages: [{ id: 'p1', senderId: 'priya', type: 'snap', opened: true }],
  },
  {
    id: 'tomasz', title: 'Tomasz W', isGroup: false, memberIds: ['tomasz'],
    status: { kind: 'received', medium: 'chat', time: '3h', streak: 4 },
    messages: [{ id: 't1', senderId: 'tomasz', type: 'text', text: 'lol yes' }],
  },
  {
    id: 'imogen', title: 'Imogen Rae', isGroup: false, memberIds: ['imogen'],
    status: { kind: 'opened', medium: 'chat', time: '5h' },
    watch: true,
    messages: [{ id: 'i1', senderId: 'imogen', type: 'text', text: 'did you watch it yet?' }],
  },
  {
    id: 'dara', title: 'Dara K', isGroup: false, memberIds: ['dara'],
    status: { kind: 'tap-to-chat', medium: 'chat' },
    messages: [],
  },
  {
    id: 'alexandria', title: 'Alexandria Montgomery-Featherstone', isGroup: false, memberIds: ['alexandria'],
    status: { kind: 'opened', medium: 'snap', time: '1d' },
    messages: [{ id: 'al1', senderId: 'alexandria', type: 'text', text: 'long name check' }],
  },
];
