// Chats and people for tests: what a device holds after a while in use. The app itself ships
// none (a first run starts with an empty chat list).

import { ME } from '../types';
import type { Chat, Person } from '../types';

export const fixturePeople: Person[] = [
  { id: 'beatriz', name: 'Beatriz M', seed: 11, color: '#00C67F' },
  { id: 'julie', name: '💎Julie💎', seed: 12, color: '#A05DCD' },
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

export const fixturePeopleById: Record<string, Person> = Object.fromEntries(fixturePeople.map((p) => [p.id, p]));

/**
 * One-to-one chats with the fixture people, shaped like the chats the app makes (ME is a member),
 * so loading them never mistakes them for the old dummy chats.
 */
export const fixtureChats: Chat[] = [
  {
    id: 'beatriz', title: 'Beatriz M', isGroup: false, memberIds: ['beatriz', ME],
    status: { kind: 'opened', medium: 'chat', time: '2h' },
    messages: [{ id: 'b1', senderId: 'beatriz', type: 'text', text: 'see you tomorrow!' }],
  },
  {
    id: 'julie', title: '💎Julie💎', isGroup: false, memberIds: ['julie', ME],
    status: { kind: 'received', medium: 'chat', time: '16m', streak: 29 },
    messages: [{ id: 'j1', senderId: 'julie', type: 'text', text: 'lol yes' }],
  },
  {
    id: 'moe', title: 'Moe S', isGroup: false, memberIds: ['moe', ME],
    status: { kind: 'delivered', medium: 'snap', time: '25m', streak: 29 },
    messages: [{ id: 'm1', senderId: ME, type: 'snap', opened: false }],
  },
  {
    id: 'andy', title: 'Andy G', isGroup: false, memberIds: ['andy', ME],
    status: { kind: 'screenshot', medium: 'chat', time: '1h' },
    messages: [{ id: 'a1', senderId: 'andy', type: 'text', text: 'ok that one was good' }],
  },
  {
    id: 'callum', title: 'Callum B', isGroup: false, memberIds: ['callum', ME],
    status: { kind: 'opened', medium: 'snap', time: '1h' },
    messages: [{ id: 'c1', senderId: ME, type: 'snap', opened: true }],
  },
  {
    id: 'jess', title: 'Jess Alan', isGroup: false, memberIds: ['jess', ME],
    status: { kind: 'opened', medium: 'chat', time: '1h' },
    messages: [{ id: 'je1', senderId: ME, type: 'text', text: 'see you at 7' }],
  },
  {
    id: 'priya', title: 'Priya N', isGroup: false, memberIds: ['priya', ME],
    status: { kind: 'received', medium: 'snap', time: '2h' },
    messages: [{ id: 'p1', senderId: 'priya', type: 'snap', opened: true }],
  },
  {
    id: 'tomasz', title: 'Tomasz W', isGroup: false, memberIds: ['tomasz', ME],
    status: { kind: 'received', medium: 'chat', time: '3h', streak: 4 },
    messages: [{ id: 't1', senderId: 'tomasz', type: 'text', text: 'lol yes' }],
  },
  {
    id: 'imogen', title: 'Imogen Rae', isGroup: false, memberIds: ['imogen', ME],
    status: { kind: 'opened', medium: 'chat', time: '5h' },
    watch: true,
    messages: [{ id: 'i1', senderId: 'imogen', type: 'text', text: 'did you watch it yet?' }],
  },
  {
    id: 'dara', title: 'Dara K', isGroup: false, memberIds: ['dara', ME],
    status: { kind: 'tap-to-chat', medium: 'chat' },
    messages: [],
  },
  {
    id: 'alexandria', title: 'Alexandria Montgomery-Featherstone', isGroup: false, memberIds: ['alexandria', ME],
    status: { kind: 'opened', medium: 'snap', time: '1d' },
    messages: [{ id: 'al1', senderId: 'alexandria', type: 'text', text: 'long name check' }],
  },
];

/**
 * AppProvider props that start it like a device in use for a while: `chats` (default: the fixture
 * chats) when nothing is saved, and the fixture people plus `people`.
 */
export function fixtures({ chats = fixtureChats, people = {} }: { chats?: Chat[]; people?: Record<string, Person> } = {}) {
  return { initialChats: chats, initialPeople: { ...fixturePeopleById, ...people } };
}
