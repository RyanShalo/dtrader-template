import React from 'react';

import { Flyout } from '@deriv/components';
import { StandaloneClockThreeFillIcon } from '@deriv/quill-icons';
import { observer, useStore } from '@deriv/stores';
import { Localize } from '@deriv-com/translations';

import { PositionsDrawerContent, PositionsDrawerFooter } from 'AppV2/Components/Layout/Sidebar/PositionsDrawer';

import './positions-fab.scss';

/**
 * Floating Positions Button + mounted Flyout.
 *
 * The original Sidebar (removed for the embedded experience) was where both
 * the Positions trigger AND the <Flyout> lived. This component restores the
 * minimum needed to access open positions from inside the trader: a small
 * floating button anchored bottom-right with an open-positions count badge,
 * and the same <Flyout> the sidebar used, mounted standalone.
 *
 * Only renders when the user is logged in. Hides itself if there are no open
 * positions AND the flyout is closed, so it doesn't crowd the UI when idle.
 */
const PositionsFab = observer(() => {
    const { client, ui, portfolio } = useStore();
    const { is_logged_in } = client;
    const { active_sidebar_flyout, setSidebarFlyout, closeSidebarFlyout } = ui;
    const { active_positions_count, onMount, onUnmount } = portfolio;

    // Keep the portfolio store subscribed so active_positions_count stays live.
    React.useEffect(() => {
        if (!is_logged_in) return undefined;
        onMount();
        return () => onUnmount();
    }, [is_logged_in, onMount, onUnmount]);

    if (!is_logged_in) return null;

    const isPositionsOpen = active_sidebar_flyout === 'positions';
    const handleToggle = () => {
        setSidebarFlyout(isPositionsOpen ? null : 'positions');
    };

    // Only mount the flyout when there's actually content to show, so the
    // dim backdrop doesn't briefly flash on first render.
    const flyout =
        active_sidebar_flyout === 'positions' ? (
            <Flyout
                is_open
                onClose={closeSidebarFlyout}
                title={<Localize i18n_default_text='Open positions' />}
                footer_content={<PositionsDrawerFooter />}
            >
                <PositionsDrawerContent />
            </Flyout>
        ) : null;

    return (
        <React.Fragment>
            <button
                type='button'
                className='positions-fab'
                onClick={handleToggle}
                aria-label='Open positions'
                aria-pressed={isPositionsOpen}
            >
                <StandaloneClockThreeFillIcon iconSize='md' fill='#fff' />
                {active_positions_count > 0 && (
                    <span className='positions-fab__badge' aria-label={`${active_positions_count} open positions`}>
                        {active_positions_count > 99 ? '99+' : active_positions_count}
                    </span>
                )}
            </button>
            {flyout}
        </React.Fragment>
    );
});

export default PositionsFab;
