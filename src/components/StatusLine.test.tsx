import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusLine } from './StatusLine';
import type { ChatStatus } from '../types';

const renderStatus = (status: ChatStatus) => render(<StatusLine status={status} />);

describe('StatusLine', () => {
  afterEach(cleanup);

  it('renders word, time and streak', () => {
    const { container } = renderStatus({ kind: 'new-snap', medium: 'snap', time: '16m', streak: 29 });
    expect(container).toHaveTextContent(/^New Snap · 16m · 29🔥$/);
  });

  it('renders transmit progress as a percentage', () => {
    const { container } = renderStatus({ kind: 'transmitting', medium: 'snap', progress: 0.34 });
    expect(container).toHaveTextContent(/^Transmitting · 34%$/);
  });

  it('renders receive progress as a percentage', () => {
    const { container } = renderStatus({ kind: 'receiving', medium: 'snap', progress: 0.62 });
    expect(container).toHaveTextContent(/^Receiving · 62%$/);
  });

  it('renders Queued', () => {
    const { container } = renderStatus({ kind: 'queued', medium: 'chat' });
    expect(container).toHaveTextContent(/^Queued$/);
  });

  it('colours the word red for a new snap', () => {
    renderStatus({ kind: 'new-snap', medium: 'snap', time: '16m' });
    expect(screen.getByText('New Snap')).toHaveStyle({ color: 'var(--red)' });
  });

  it('colours the word blue for a new chat', () => {
    renderStatus({ kind: 'new-chat', medium: 'chat', time: '16m' });
    expect(screen.getByText('New Chat')).toHaveStyle({ color: 'var(--blue)' });
  });

  it('colours the word green while receiving a snap', () => {
    renderStatus({ kind: 'receiving', medium: 'snap', progress: 0.62 });
    expect(screen.getByText('Receiving')).toHaveStyle({ color: 'var(--green)' });
  });

  it('shows an incoming text as blue Receiving… without a percentage', () => {
    const { container } = renderStatus({ kind: 'receiving', medium: 'chat' });
    expect(container).toHaveTextContent(/^Receiving…$/);
    expect(screen.getByText('Receiving…')).toHaveStyle({ color: 'var(--blue)' });
  });

  it('keeps settled words grey and colours only the icon by medium', () => {
    const { container } = renderStatus({ kind: 'opened', medium: 'snap', time: '1h' });
    expect(screen.getByText('Opened')).toHaveStyle({ color: 'var(--text-2)' });
    expect(container.querySelector('.status-line__icon')).toHaveStyle({ color: 'var(--red)' });
  });
});
