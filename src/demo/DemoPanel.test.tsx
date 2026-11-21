import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoPanel } from './DemoPanel';

const demoIncoming = vi.fn();
const resetDemo = vi.fn();
vi.mock('../state/store', () => ({
  useApp: () => ({
    people: { me: { id: 'me', name: 'Me' }, ava: { id: 'ava', name: 'Ava' }, bo: { id: 'bo', name: 'Bo' } },
    demoIncoming,
    resetDemo,
  }),
}));

const toggle = () => fireEvent.keyDown(window, { key: 'D', shiftKey: true });

describe('DemoPanel', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('is hidden by default and toggles with Shift+D', () => {
    render(<DemoPanel />);
    expect(screen.queryByText('Demo')).toBeNull();
    toggle();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    toggle();
    expect(screen.queryByText('Demo')).toBeNull();
  });

  it('ignores the shortcut inside inputs', () => {
    render(<><input aria-label="x" /><DemoPanel /></>);
    fireEvent.keyDown(screen.getByLabelText('x'), { key: 'D', shiftKey: true });
    expect(screen.queryByText('Demo')).toBeNull();
  });

  it('excludes ME and calls store functions', () => {
    render(<DemoPanel />);
    toggle();
    expect(screen.queryByRole('option', { name: 'Me' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'bo' } });
    fireEvent.click(screen.getByText('Incoming snap'));
    expect(demoIncoming).toHaveBeenCalledWith('bo', 'snap');
    fireEvent.click(screen.getByText('Incoming text'));
    expect(demoIncoming).toHaveBeenCalledWith('bo', 'text');
    fireEvent.click(screen.getByText('Reset demo'));
    expect(resetDemo).toHaveBeenCalled();
  });
});
