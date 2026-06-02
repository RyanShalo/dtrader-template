import React from 'react';

import NetworkStatus from '@deriv/core/src/App/Components/Layout/Footer/network-status';

import './trade-params-footer.scss';

// DateTime and ToggleFullScreen intentionally removed for the embedded/host
// experience — the host frames the app and provides its own chrome.
const TradeParamsFooter: React.FC = () => {
    return (
        <div className='trade-params-footer'>
            <NetworkStatus />
        </div>
    );
};

TradeParamsFooter.displayName = 'TradeParamsFooter';

export default TradeParamsFooter;
