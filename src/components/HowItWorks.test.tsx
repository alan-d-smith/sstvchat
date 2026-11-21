import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HowItWorks, STEPS, howItWorksSeen, markHowItWorksSeen } from './HowItWorks';

const current = () => screen.getAllByRole('listitem').findIndex((li) => li.getAttribute('aria-current') === 'step');

function reduceMotion(on: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: on && q.includes('prefers-reduced-motion: reduce'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HowItWorks', () => {
  it('describes the scene and lists the steps as text', () => {
    render(<HowItWorks variant="welcome" onDone={() => {}} />);
    expect(screen.getByRole('img', { name: /laptop sending a chat to a phone as sound.*microphone hears it/s })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(STEPS.map((s, i) => `${i + 1}${s}`));
    expect(screen.getByText(/International Space Station sends pictures down to Earth with SSTV/)).toBeInTheDocument();
  });

  it('highlights the caption for the current step, loops, and Replay starts over', () => {
    vi.useFakeTimers();
    reduceMotion(false);
    render(<HowItWorks variant="welcome" onDone={() => {}} />);
    expect(current()).toBe(0);
    act(() => { vi.advanceTimersByTime(3300); });
    expect(current()).toBe(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(current()).toBe(2);
    expect(screen.getByText('Typing…')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(current()).toBe(3);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); }); // past the end: the loop starts again
    expect(current()).toBe(0);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(current()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(current()).toBe(0);
  });

  it('shows a still final frame and a plain numbered list when motion is reduced', () => {
    reduceMotion(true);
    render(<HowItWorks variant="welcome" onDone={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
    expect(current()).toBe(-1);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('to: you · from: alan')).toBeInTheDocument();
  });

  it('welcome has Get started and Skip; modal has Got it, Close and Escape', () => {
    const done = vi.fn();
    const { unmount } = render(<HowItWorks variant="welcome" onDone={done} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(done).toHaveBeenCalledTimes(2);
    unmount();

    done.mockClear();
    render(<HowItWorks variant="modal" onDone={done} />);
    expect(screen.getByRole('dialog', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(done).toHaveBeenCalledTimes(3);
  });

  it('remembers that it was seen, and survives blocked storage', () => {
    expect(howItWorksSeen()).toBe(false);
    markHowItWorksSeen();
    expect(howItWorksSeen()).toBe(true);
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(howItWorksSeen()).toBe(false);
    expect(() => markHowItWorksSeen()).not.toThrow();
    blocked.mockRestore();
    vi.restoreAllMocks();
  });
});
