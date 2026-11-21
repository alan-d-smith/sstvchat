import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppProvider } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { SendToList } from './SendToList';
import { fixtures } from '../test/fixtures';

function setup(initial?: string) {
  const onSend = vi.fn();
  render(
    <AppProvider {...fixtures()} transport={createMockTransport()}>
      <SendToList initial={initial} onSend={onSend} />
    </AppProvider>,
  );
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
  const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
  return { onSend, box, send };
}

describe('SendToList', () => {
  it('lists every chat as a checkbox row', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Beatriz M' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '💎Julie💎' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Moe S' })).toBeInTheDocument();
  });

  it('preselects the initial chat only', () => {
    const { box } = setup('julie');
    expect(box('💎Julie💎')).toBeChecked();
    expect(box('Beatriz M')).not.toBeChecked();
    expect(box('Moe S')).not.toBeChecked();
  });

  it('toggles selection when rows are clicked', () => {
    const { box } = setup('julie');
    fireEvent.click(box('Moe S'));
    expect(box('Moe S')).toBeChecked();
    fireEvent.click(box('💎Julie💎'));
    expect(box('💎Julie💎')).not.toBeChecked();
  });

  it('disables Send while nothing is selected', () => {
    const { box, send } = setup();
    expect(send()).toBeDisabled();
    fireEvent.click(box('Beatriz M'));
    expect(send()).toBeEnabled();
    fireEvent.click(box('Beatriz M'));
    expect(send()).toBeDisabled();
  });

  it('shows the selected names and sends their ids in selection order', () => {
    const { box, send, onSend } = setup('julie');
    fireEvent.click(box('Moe S'));
    expect(screen.getByText('💎Julie💎, Moe S')).toBeInTheDocument();
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(['julie', 'moe']);
  });

  it('filters rows by search but keeps hidden selections', () => {
    const { box, send, onSend } = setup('julie');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'moe' } });
    expect(screen.queryByRole('checkbox', { name: 'Beatriz M' })).toBeNull();
    fireEvent.click(box('Moe S'));
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledWith(['julie', 'moe']);
  });
});
