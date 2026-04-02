import { Tabs } from '../../../../dockview/components/titlebar/tabs';
import { fromPartial } from '@total-typescript/shoehorn';
import { DockviewGroupPanel } from '../../../../dockview/dockviewGroupPanel';
import { DockviewComponent } from '../../../../dockview/dockviewComponent';
import { IDockviewPanel } from '../../../../dockview/dockviewPanel';
import { ITabRenderer } from '../../../../dockview/types';
import { IDockviewPanelModel } from '../../../../dockview/dockviewPanelModel';
import { fireEvent } from '@testing-library/dom';
import * as dataTransfer from '../../../../dnd/dataTransfer';
import { TabAnimation } from '../../../../dockview/options';

function makeDOMRect(
    x: number,
    y: number,
    width: number,
    height: number
): DOMRect {
    return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
    } as DOMRect;
}

function createMockPanel(id: string): IDockviewPanel {
    const tabRenderer: ITabRenderer = {
        element: document.createElement('div'),
        init: jest.fn(),
        update: jest.fn(),
        dispose: jest.fn(),
    };

    return fromPartial<IDockviewPanel>({
        id,
        view: fromPartial<IDockviewPanelModel>({
            tab: tabRenderer,
        }),
    });
}

function createTabs(
    options: {
        tabAnimation?: TabAnimation;
        disableDnd?: boolean;
    } = {}
): { tabs: Tabs; accessor: DockviewComponent; group: DockviewGroupPanel } {
    const accessor = fromPartial<DockviewComponent>({
        id: 'test-accessor',
        options: {
            tabAnimation: options.tabAnimation,
            disableDnd: options.disableDnd,
        },
    });

    const group = fromPartial<DockviewGroupPanel>({
        id: 'test-group',
        locked: false,
        model: fromPartial({
            canDisplayOverlay: jest.fn().mockReturnValue(true),
            dropTargetContainer: undefined,
        }),
    });

    const tabs = new Tabs(group, accessor, {
        showTabsOverflowControl: false,
    });

    return { tabs, accessor, group };
}

function getTabElements(tabs: Tabs): HTMLElement[] {
    return (tabs as any)._tabs.map(
        (t: { value: { element: HTMLElement } }) => t.value.element
    );
}

function getAnimState(tabs: Tabs): any {
    return (tabs as any)._animState;
}

function mockTabRect(
    element: HTMLElement,
    rect: { left: number; width: number }
): void {
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue(
        makeDOMRect(rect.left, 0, rect.width, 30)
    );
}

describe('tabs - animation', () => {
    let rAFCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        rAFCallbacks = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rAFCallbacks.push(cb);
            return rAFCallbacks.length;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function flushRAF() {
        const callbacks = [...rAFCallbacks];
        rAFCallbacks = [];
        for (const cb of callbacks) {
            cb(performance.now());
        }
    }

    describe('animation state initialization', () => {
        test('dragstart initializes animation state when animation enabled', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            expect(getAnimState(tabs)).toBeNull();

            fireEvent.dragStart(elements[0]);

            const state = getAnimState(tabs);
            expect(state).not.toBeNull();
            expect(state.sourceTabId).toBe('panel-a');
            expect(state.sourceIndex).toBe(0);
            expect(state.tabPositions).toBeInstanceOf(Map);
            expect(state.tabPositions.size).toBe(2);
            expect(state.currentInsertionIndex).toBeNull();
        });

        test('dragstart does not initialize state when tabAnimation is default', () => {
            const { tabs } = createTabs({ tabAnimation: 'default' });
            const panel = createMockPanel('panel-a');

            tabs.openPanel(panel, 0);

            const elements = getTabElements(tabs);
            fireEvent.dragStart(elements[0]);

            expect(getAnimState(tabs)).toBeNull();
        });

        test('dragstart does not initialize state when disableDnd is true', () => {
            const { tabs } = createTabs({ disableDnd: true });
            const panel = createMockPanel('panel-a');

            tabs.openPanel(panel, 0);

            const elements = getTabElements(tabs);
            fireEvent.dragStart(elements[0]);

            // disableDnd prevents DragHandler from processing the event
            // so Tab's onDragStart never fires, and _animState stays null
            expect(getAnimState(tabs)).toBeNull();
        });
    });

    describe('source tab collapse', () => {
        test('dragstart adds dv-tab--dragging class when animation enabled', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panel = createMockPanel('panel-a');

            tabs.openPanel(panel, 0);

            const elements = getTabElements(tabs);
            expect(
                elements[0].classList.contains('dv-tab--dragging')
            ).toBeFalsy();

            fireEvent.dragStart(elements[0]);
            flushRAF();

            expect(
                elements[0].classList.contains('dv-tab--dragging')
            ).toBeTruthy();
        });

        test('dragstart does not add dv-tab--dragging class when tabAnimation is default', () => {
            const { tabs } = createTabs({ tabAnimation: 'default' });
            const panel = createMockPanel('panel-a');

            tabs.openPanel(panel, 0);

            const elements = getTabElements(tabs);
            fireEvent.dragStart(elements[0]);

            expect(
                elements[0].classList.contains('dv-tab--dragging')
            ).toBeFalsy();
        });
    });

    describe('drag cancellation', () => {
        test('dragend resets animation state and removes dragging class', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Start drag
            fireEvent.dragStart(elements[0]);
            flushRAF();
            expect(getAnimState(tabs)).not.toBeNull();
            expect(
                elements[0].classList.contains('dv-tab--dragging')
            ).toBeTruthy();

            // Cancel drag (dragend on container - simulating cancel)
            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragEnd(tabsList);

            expect(getAnimState(tabs)).toBeNull();
            expect(
                elements[0].classList.contains('dv-tab--dragging')
            ).toBeFalsy();
        });

        test('dragend removes shifting classes and transforms from all tabs', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Manually set transforms and classes to simulate mid-animation
            elements[0].style.transform = 'translateX(100px)';
            elements[0].classList.add('dv-tab--shifting');
            elements[1].style.transform = 'translateX(-100px)';
            elements[1].classList.add('dv-tab--shifting');

            // Set animation state
            (tabs as any)._animState = {
                sourceTabId: 'panel-a',
                sourceIndex: 0,
                tabPositions: new Map(),
                currentInsertionIndex: null,
            };

            // Trigger dragend
            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragEnd(tabsList);

            expect(elements[0].style.transform).toBe('');
            expect(elements[1].style.transform).toBe('');
            expect(
                elements[0].classList.contains('dv-tab--shifting')
            ).toBeFalsy();
            expect(
                elements[1].classList.contains('dv-tab--shifting')
            ).toBeFalsy();
        });
    });

    describe('FLIP animation', () => {
        test('runFlipAnimation applies inverse transforms for moved tabs', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);

            const elements = getTabElements(tabs);

            // Create "first" positions (before DOM reorder)
            const firstPositions = new Map<string, DOMRect>();
            firstPositions.set('panel-a', makeDOMRect(0, 0, 80, 30));
            firstPositions.set('panel-b', makeDOMRect(80, 0, 80, 30));
            firstPositions.set('panel-c', makeDOMRect(160, 0, 80, 30));

            // Mock "last" positions (after DOM reorder: A moved from 0 to 160)
            mockTabRect(elements[0], { left: 160, width: 80 });
            mockTabRect(elements[1], { left: 0, width: 80 });
            mockTabRect(elements[2], { left: 80, width: 80 });

            // Run FLIP (source tab is panel-a, so B and C should get transforms)
            (tabs as any).runFlipAnimation(firstPositions, 'panel-a');

            // panel-b: was at 80, now at 0 → delta = +80
            expect(elements[1].style.transform).toBe('translateX(80px)');
            expect(
                elements[1].classList.contains('dv-tab--shifting')
            ).toBeTruthy();

            // panel-c: was at 160, now at 80 → delta = +80
            expect(elements[2].style.transform).toBe('translateX(80px)');
            expect(
                elements[2].classList.contains('dv-tab--shifting')
            ).toBeTruthy();

            // panel-a (source) should not have transform
            expect(elements[0].style.transform).toBe('');
        });

        test('runFlipAnimation removes transforms in requestAnimationFrame', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            const firstPositions = new Map<string, DOMRect>();
            firstPositions.set('panel-a', makeDOMRect(0, 0, 80, 30));
            firstPositions.set('panel-b', makeDOMRect(80, 0, 80, 30));

            // panel-b moved from 80 to 0
            mockTabRect(elements[0], { left: 80, width: 80 });
            mockTabRect(elements[1], { left: 0, width: 80 });

            (tabs as any).runFlipAnimation(firstPositions, 'panel-a');

            // Before rAF: transform should be applied
            expect(elements[1].style.transform).toBe('translateX(80px)');

            // Flush rAF
            flushRAF();

            // After rAF: transform should be removed (CSS transition takes over)
            expect(elements[1].style.transform).toBe('');
        });

        test('no animation when no tabs moved (drop at original position)', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            const firstPositions = new Map<string, DOMRect>();
            firstPositions.set('panel-a', makeDOMRect(0, 0, 80, 30));
            firstPositions.set('panel-b', makeDOMRect(80, 0, 80, 30));

            // Same positions after "reorder" (no actual move)
            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });

            (tabs as any).runFlipAnimation(firstPositions, 'panel-a');

            // No transforms should be applied (delta < 1)
            expect(elements[0].style.transform).toBe('');
            expect(elements[1].style.transform).toBe('');

            // No rAF should be queued
            expect(rAFCallbacks.length).toBe(0);
        });
    });

    describe('resetTabTransforms', () => {
        test('clears all transforms and shifting classes', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Set up transforms
            elements[0].style.transform = 'translateX(50px)';
            elements[0].classList.add('dv-tab--shifting');
            elements[1].style.transform = 'translateX(-50px)';
            elements[1].classList.add('dv-tab--shifting');

            (tabs as any).resetTabTransforms();

            expect(elements[0].style.transform).toBe('');
            expect(elements[1].style.transform).toBe('');
            expect(
                elements[0].classList.contains('dv-tab--shifting')
            ).toBeFalsy();
            expect(
                elements[1].classList.contains('dv-tab--shifting')
            ).toBeFalsy();
        });
    });

    describe('dispose cleanup', () => {
        test('dispose during active drag clears animation state', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Start drag
            fireEvent.dragStart(elements[0]);
            expect(getAnimState(tabs)).not.toBeNull();

            // Dispose
            tabs.dispose();

            expect(getAnimState(tabs)).toBeNull();
        });
    });

    describe('delete cleanup', () => {
        test('deleting source tab during cross-group move clears animation state', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Simulate drag start
            fireEvent.dragStart(elements[0]);
            expect(getAnimState(tabs)).not.toBeNull();
            expect(getAnimState(tabs).sourceTabId).toBe('panel-a');

            // Simulate cross-group removal (the tab is deleted from this group)
            tabs.delete('panel-a');

            expect(getAnimState(tabs)).toBeNull();
        });

        test('deleting non-source tab does not clear animation state', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);

            const elements = getTabElements(tabs);

            // Start drag on panel-a
            fireEvent.dragStart(elements[0]);
            expect(getAnimState(tabs)).not.toBeNull();

            // Delete a different tab
            tabs.delete('panel-c');

            // Animation state should still exist
            expect(getAnimState(tabs)).not.toBeNull();
            expect(getAnimState(tabs).sourceTabId).toBe('panel-a');
        });
    });

    describe('handleDragOver', () => {
        test('updates currentInsertionIndex based on cursor position', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);

            const elements = getTabElements(tabs);

            // Mock tab positions
            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });
            mockTabRect(elements[2], { left: 160, width: 80 });

            // Start drag on panel-a
            fireEvent.dragStart(elements[0]);
            expect(getAnimState(tabs)).not.toBeNull();

            // Call handleDragOver directly with a mock event
            const mockEvent = { clientX: 120 } as DragEvent;
            (tabs as any).handleDragOver(mockEvent);

            // panel-a (index 0) is source → skipped
            // panel-b (index 1): midpoint = 120, 120 < 120 → false, insertionIndex = 2
            // panel-c (index 2): midpoint = 200, 120 < 200 → true, insertionIndex = 2
            expect(getAnimState(tabs).currentInsertionIndex).toBe(2);
        });
    });

    describe('dragover gap transforms', () => {
        test('tabs after insertion index shift right by source tab width', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');
            const panelD = createMockPanel('panel-d');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);
            tabs.openPanel(panelD, 3);

            const elements = getTabElements(tabs);

            // Mock positions for dragstart snapshot
            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });
            mockTabRect(elements[2], { left: 160, width: 80 });
            mockTabRect(elements[3], { left: 240, width: 80 });

            // Start drag on panel-b (index 1)
            fireEvent.dragStart(elements[1]);
            expect(getAnimState(tabs)).not.toBeNull();

            // Source tab width was captured as 80px
            // Simulate cursor at position 200 (right half of panel-c)
            (tabs as any).handleDragOver({ clientX: 200 } as DragEvent);

            // panel-a (index 0): 0 < insertionIndex → no margin
            expect(elements[0].style.marginLeft).toBe('');

            // panel-b (index 1, source): skipped
            // panel-c (index 2): check if shifted depends on insertionIndex
            // panel-d (index 3): should get margin-left

            // cursor 200: A(skip? no, not source), midpoint=40 → 200>40 → continue
            // B(source, skip), C midpoint=200 → 200<200=false → insertionIndex=3
            // D midpoint=280 → 200<280=true → insertionIndex=3. break.
            expect(getAnimState(tabs).currentInsertionIndex).toBe(3);

            // First non-source tab at index >= 3: panel-d gets margin-left of 80
            expect(elements[3].style.marginLeft).toBe('80px');
            expect(
                elements[3].classList.contains('dv-tab--shifting')
            ).toBeTruthy();

            // panel-c (index 2 < 3): no margin
            expect(elements[2].style.marginLeft).toBe('');
        });

        test('gap moves when cursor moves to different position', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);

            const elements = getTabElements(tabs);

            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });
            mockTabRect(elements[2], { left: 160, width: 80 });

            // Start drag on panel-a (source, width 80)
            fireEvent.dragStart(elements[0]);

            // Move cursor to left half of panel-b (insert before B)
            (tabs as any).handleDragOver({ clientX: 90 } as DragEvent);

            // A(source, skip). B midpoint=120, 90<120 → insertionIndex=1
            expect(getAnimState(tabs).currentInsertionIndex).toBe(1);
            // First non-source tab at index >= 1: panel-b gets margin-left
            expect(elements[1].style.marginLeft).toBe('80px');
            // panel-c: not the first tab at >= insertionIndex, no margin
            expect(elements[2].style.marginLeft).toBe('');

            // Now move cursor to right half of panel-c (insert after C)
            (tabs as any).handleDragOver({ clientX: 220 } as DragEvent);

            // A(source, skip). B midpoint=120, 220>120 → continue, insertionIndex=2.
            // C midpoint=200, 220>200 → continue, insertionIndex=3. Loop ends.
            expect(getAnimState(tabs).currentInsertionIndex).toBe(3);
            // No tabs at index >= 3 → margins animate to 0 (transition pending in real
            // browser; in JSDOM without CSS transitions the value is '0px' until
            // transitionend fires, at which point the property is removed entirely)
            expect(['', '0px']).toContain(elements[1].style.marginLeft);
            expect(['', '0px']).toContain(elements[2].style.marginLeft);
        });

        test('same insertion index skips transform update', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });

            fireEvent.dragStart(elements[0]);

            // First dragover
            (tabs as any).handleDragOver({ clientX: 90 } as DragEvent);
            const firstIndex = getAnimState(tabs).currentInsertionIndex;

            // Spy on applyDragOverTransforms to check if it's called again
            const applySpy = jest.spyOn(tabs as any, 'applyDragOverTransforms');

            // Second dragover with same result
            (tabs as any).handleDragOver({ clientX: 95 } as DragEvent);

            // Same insertion index → applyDragOverTransforms should not be called
            expect(getAnimState(tabs).currentInsertionIndex).toBe(firstIndex);
            expect(applySpy).not.toHaveBeenCalled();

            applySpy.mockRestore();
        });
    });

    describe('cross-group animation (US3)', () => {
        test('external dragover initializes animation state with sourceIndex -1', () => {
            const { tabs, group } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);
            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });

            // Mock getPanelData to return an external group's panel
            const spy = jest
                .spyOn(dataTransfer, 'getPanelData')
                .mockReturnValue(
                    new dataTransfer.PanelTransfer(
                        'test-accessor',
                        'other-group',
                        'external-panel'
                    )
                );

            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragOver(tabsList);

            const state = getAnimState(tabs);
            expect(state).not.toBeNull();
            expect(state.sourceTabId).toBe('external-panel');
            expect(state.sourceIndex).toBe(-1);
            expect(state.tabPositions.size).toBe(2);

            spy.mockRestore();
        });

        test('external dragover does not initialize state when tabAnimation is default', () => {
            const { tabs } = createTabs({ tabAnimation: 'default' });
            const panel = createMockPanel('panel-a');
            tabs.openPanel(panel, 0);

            const spy = jest
                .spyOn(dataTransfer, 'getPanelData')
                .mockReturnValue(
                    new dataTransfer.PanelTransfer(
                        'test-accessor',
                        'other-group',
                        'external-panel'
                    )
                );

            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragOver(tabsList);

            expect(getAnimState(tabs)).toBeNull();

            spy.mockRestore();
        });

        test('external dragover uses average tab width for gap', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);
            mockTabRect(elements[0], { left: 0, width: 100 });
            mockTabRect(elements[1], { left: 100, width: 60 });

            // Manually initialize external drag state (as dragover listener would)
            (tabs as any)._animState = {
                sourceTabId: 'external-panel',
                sourceIndex: -1,
                tabPositions: (tabs as any).snapshotTabPositions(),
                currentInsertionIndex: null,
            };

            // cursor at 30 → left half of panel-a (midpoint 50) → insert at index 0
            (tabs as any).handleDragOver({ clientX: 30 } as DragEvent);

            // Average width: (100 + 60) / 2 = 80
            // First non-source tab at index >= 0: panel-a gets margin-left of 80
            expect(elements[0].style.marginLeft).toBe('80px');
            // panel-b: not the first tab at >= insertionIndex, no margin
            expect(elements[1].style.marginLeft).toBe('');
        });

        test('dragleave fully clears state for external drags', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            tabs.openPanel(panelA, 0);

            const elements = getTabElements(tabs);
            mockTabRect(elements[0], { left: 0, width: 80 });

            const spy = jest
                .spyOn(dataTransfer, 'getPanelData')
                .mockReturnValue(
                    new dataTransfer.PanelTransfer(
                        'test-accessor',
                        'other-group',
                        'external-panel'
                    )
                );

            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragOver(tabsList);
            expect(getAnimState(tabs)).not.toBeNull();

            // Simulate dragleave (cursor leaves container entirely)
            const dragLeaveEvent = new Event('dragleave', { bubbles: true });
            tabsList.dispatchEvent(dragLeaveEvent);

            // External drag: state should be fully cleared (not just insertionIndex)
            expect(getAnimState(tabs)).toBeNull();

            spy.mockRestore();
        });

        test('same-group dragover does not trigger external detection', () => {
            const { tabs, group } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            tabs.openPanel(panelA, 0);

            // Mock getPanelData to return same group
            const spy = jest
                .spyOn(dataTransfer, 'getPanelData')
                .mockReturnValue(
                    new dataTransfer.PanelTransfer(
                        'test-accessor',
                        'test-group',
                        'panel-a'
                    )
                );

            const tabsList = (tabs as any)._tabsList as HTMLElement;
            fireEvent.dragOver(tabsList);

            // Should NOT initialize _animState (same group)
            expect(getAnimState(tabs)).toBeNull();

            spy.mockRestore();
        });

        test('cross-group FLIP animates newly inserted tab with slide-in', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');
            const panelC = createMockPanel('panel-c');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);
            tabs.openPanel(panelC, 2);

            const elements = getTabElements(tabs);

            // First positions (before cross-group drop)
            const firstPositions = new Map<string, DOMRect>();
            firstPositions.set('panel-a', makeDOMRect(0, 0, 80, 30));
            firstPositions.set('panel-b', makeDOMRect(80, 0, 80, 30));
            // panel-c is the newly inserted tab — NOT in firstPositions

            // "Last" positions (after new tab inserted at index 2)
            mockTabRect(elements[0], { left: 0, width: 80 });
            mockTabRect(elements[1], { left: 80, width: 80 });
            mockTabRect(elements[2], { left: 160, width: 80 });

            // isCrossGroup = true, sourceTabId = 'panel-c' (newly inserted)
            (tabs as any).runFlipAnimation(firstPositions, 'panel-c', true);

            // panel-c (source, cross-group): should get slide-in transform
            expect(elements[2].style.transform).toBe('translateX(80px)');
            expect(
                elements[2].classList.contains('dv-tab--shifting')
            ).toBeTruthy();

            // panel-a and panel-b: same positions → no delta → no transform
            expect(elements[0].style.transform).toBe('');
            expect(elements[1].style.transform).toBe('');
        });

        test('cross-group FLIP does NOT animate source tab for same-group drops', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            const firstPositions = new Map<string, DOMRect>();
            firstPositions.set('panel-a', makeDOMRect(0, 0, 80, 30));
            firstPositions.set('panel-b', makeDOMRect(80, 0, 80, 30));

            mockTabRect(elements[0], { left: 80, width: 80 });
            mockTabRect(elements[1], { left: 0, width: 80 });

            // isCrossGroup = false (default), sourceTabId = 'panel-a'
            (tabs as any).runFlipAnimation(firstPositions, 'panel-a');

            // panel-a (source, same-group): should be skipped, no transform
            expect(elements[0].style.transform).toBe('');

            // panel-b: moved from 80 to 0 → delta = +80
            expect(elements[1].style.transform).toBe('translateX(80px)');
        });
    });

    describe('dragleave', () => {
        test('resets transforms and insertion index when cursor leaves container', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Start drag
            fireEvent.dragStart(elements[0]);

            // Manually set some state to verify it's cleared
            (tabs as any)._animState.currentInsertionIndex = 1;
            elements[1].style.marginLeft = '80px';
            elements[1].classList.add('dv-tab--shifting');

            // Simulate dragleave (cursor leaves the container entirely)
            const tabsList = (tabs as any)._tabsList as HTMLElement;
            const dragLeaveEvent = new Event('dragleave', {
                bubbles: true,
            });
            // relatedTarget is null by default → cursor left the container entirely
            tabsList.dispatchEvent(dragLeaveEvent);

            expect(elements[1].style.marginLeft).toBe('');
            expect(
                elements[1].classList.contains('dv-tab--shifting')
            ).toBeFalsy();
            expect(getAnimState(tabs).currentInsertionIndex).toBeNull();
        });

        test('does not reset when moving between child elements', () => {
            const { tabs } = createTabs({ tabAnimation: 'smooth' });
            const panelA = createMockPanel('panel-a');
            const panelB = createMockPanel('panel-b');

            tabs.openPanel(panelA, 0);
            tabs.openPanel(panelB, 1);

            const elements = getTabElements(tabs);

            // Append tabsList to document so contains() works
            const tabsList = (tabs as any)._tabsList as HTMLElement;
            document.body.appendChild(tabsList);

            // Start drag
            fireEvent.dragStart(elements[0]);

            (tabs as any)._animState.currentInsertionIndex = 1;
            elements[1].style.marginLeft = '80px';

            // Dispatch dragleave with relatedTarget being a child element
            const dragLeaveEvent = new MouseEvent('dragleave', {
                bubbles: true,
                relatedTarget: elements[1],
            });
            tabsList.dispatchEvent(dragLeaveEvent);

            // State should NOT be reset since relatedTarget is a child
            expect(elements[1].style.marginLeft).toBe('80px');
            expect(getAnimState(tabs).currentInsertionIndex).toBe(1);

            // Cleanup
            document.body.removeChild(tabsList);
        });
    });
});
