import { act, render, renderHook } from '@testing-library/react';
import React, { StrictMode, createElement, useEffect } from 'react';
import { observable } from '../../src/observable';
import { Observable } from '../../src/observableTypes';
import { observer } from '../../src/react/reactive-observer';
import { useObservable } from '../../src/react/useObservable';
import { getNode } from '../../src/globals';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { promiseTimeout, supressActWarning } from '../testglobals';
import { synced } from '../../src/sync/synced';

if (typeof document === 'undefined') {
    GlobalRegistrator.register();
}

describe('useObservable', () => {
    test('creates observable with undefined when no initial value', () => {
        const { result } = renderHook(() => useObservable());

        expect(result.current.get()).toBeUndefined();

        act(() => {
            result.current.set(100);
        });

        expect(result.current.get()).toBe(100);

        act(() => {
            result.current.set(undefined as any);
        });

        expect(result.current.get()).toBeUndefined();
    });

    // test that listeners are cleared on unmount
    test('listeners are cleared on unmount', () => {
        const { unmount, result } = renderHook(() => useObservable());

        expect(result.current.get()).toBeUndefined();

        act(() => {
            unmount();
        });

        expect(result.current.get()).toBeUndefined();
    });

    test('creates observable with Promise initial value', async () => {
        supressActWarning(async () => {
            const promise = Promise.resolve('resolved');
            const { result } = renderHook(() => useObservable(promise));

            // Initially should be the promise
            expect(result.current.get()).toBe(promise);

            await act(async () => {
                await promiseTimeout(10);
            });

            // After promise resolves, should be the resolved value
            expect(result.current.get()).toBe('resolved');
        });
    });

    test('useObservable with nested cleanup', async () => {
        const outer$ = observable(true);
        let derivedCallCount = 0;

        const Test = () => {
            const derived$ = useObservable(() => {
                derivedCallCount++;
                return `${outer$.get()}`;
            });

            return createElement('div', undefined, derived$.get());
        };

        const { unmount } = render(createElement(Test));

        expect(derivedCallCount).toBe(1);

        act(() => {
            unmount();
        });

        await act(async () => {
            await promiseTimeout(10);
        });

        const countAfterUnmount = derivedCallCount;

        // Change outer$ after unmount
        act(() => {
            outer$.set(false);
        });

        // Should not trigger derived observable after unmount
        expect(derivedCallCount).toBe(countAfterUnmount);
    });

    test('useObservable works in StrictMode', () => {
        let renderCount = 0;
        let obs$: Observable<number>;

        const Test = observer(function Test() {
            obs$ = useObservable(0);
            renderCount++;
            return createElement('div', undefined);
        });

        render(createElement(StrictMode, undefined, createElement(Test)));

        // StrictMode causes double render
        expect(renderCount).toBe(2);
        expect(obs$!.get()).toBe(0);

        act(() => {
            obs$!.set(5);
        });

        expect(renderCount).toBe(3);
        expect(obs$!.get()).toBe(5);
    });

    test('useObservable with changing deps array', () => {
        let deps = [1, 2];
        let computeCount = 0;

        const { result, rerender } = renderHook(
            ({ deps }) =>
                useObservable(() => {
                    computeCount++;
                    return deps.reduce((a, b) => a + b, 0);
                }, deps),
            { initialProps: { deps } },
        );

        expect(computeCount).toBe(1);
        expect(result.current.get()).toBe(3);

        // Change deps
        deps = [3, 4];
        rerender({ deps });

        expect(computeCount).toBe(2);
        expect(result.current.get()).toBe(7);

        // Same deps, should not recompute
        rerender({ deps: [3, 4] });
        expect(computeCount).toBe(2);
    });

    test('useObservable with a synced and deps should be reseted when deps change', async () => {
        let numSubscribes = 0;
        let numUnsubscribes = 0;

        const Test = observer(function Test({ dep }: { dep: string }) {
            const obs$ = useObservable(
                synced({
                    initial: 0,
                    subscribe: () => {
                        console.log('subscribed ' + dep);
                        numSubscribes++;
                        return () => {
                            numUnsubscribes++;
                        };
                    },
                }),
                [dep],
            );

            useEffect(() => {
                dep === 'initial' && obs$.set(2);
                console.log('effect ' + dep + ' ' + obs$.peek());
            }, [dep, obs$]);

            return createElement('div', undefined, obs$.get());
        });

        const { unmount, rerender } = render(<Test dep="initial" />);

        rerender(<Test dep="secondary" />);

        act(() => {
            unmount();
        });

        // Wait for microtask to process listeners-cleared middleware event
        await act(async () => {
            await promiseTimeout(10);
        });

        expect(numSubscribes).toBe(2);
        expect(numUnsubscribes).toBe(2);
    });

    test('useObservable with a synced should desubscribe when unmounted', async () => {
        let numSubscribes = 0;
        let numUnsubscribes = 0;
        const { unmount } = render(
            createElement(
                observer(function Test() {
                    const obs$ = useObservable(
                        synced({
                            initial: 0,
                            subscribe: () => {
                                numSubscribes++;
                                return () => {
                                    numUnsubscribes++;
                                    console.log('unsubscribed');
                                };
                            },
                        }),
                    );
                    return createElement('div', undefined, obs$.get());
                }),
            ),
        );

        act(() => {
            unmount();
        });

        // Wait for microtask to process listeners-cleared middleware event
        await act(async () => {
            await promiseTimeout(10);
        });

        expect(numSubscribes).toBe(1);
        expect(numUnsubscribes).toBe(1);
    });
});
