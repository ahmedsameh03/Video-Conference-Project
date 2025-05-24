// meeting-e2ee.js - E2EE Integration
let e2eeManager = null;

function initializeE2EE() {
  try {
    console.log('🔒 Initializing E2EE...');
    
    e2eeManager = new E2EEManager({
      roomId: room,
      workerPath: '/js/e2ee-worker.js'
    });
    
    console.log('✅ E2EE Manager initialized');
    return true;
    
  } catch (error) {
    console.error('❌ E2EE init failed:', error);
    return false;
  }
}

async function enableE2EE() {
  const password = document.getElementById('e2ee-password')?.value;
  
  if (!password || password.length < 8) {
    alert('Password must be at least 8 characters');
    return;
  }
  
  try {
    console.log('🔒 Enabling E2EE...');
    
    if (!e2eeManager) {
      if (!initializeE2EE()) {
        throw new Error('Failed to initialize E2EE manager');
      }
    }
    
    await e2eeManager.enable(password);
    
    updateE2EEStatus(true);
    console.log('✅ E2EE enabled successfully');
    
  } catch (error) {
    console.error('❌ E2EE enable failed:', error);
    alert(`E2EE enable failed: ${error.message}`);
  }
}

function updateE2EEStatus(enabled) {
  const statusText = document.getElementById('e2ee-status-text');
  const enableBtn = document.getElementById('e2ee-enable-btn');
  const disableBtn = document.getElementById('e2ee-disable-btn');
  
  if (statusText) {
    statusText.textContent = enabled ? 'E2EE Enabled' : 'E2EE Disabled';
  }
  
  if (enableBtn) enableBtn.style.display = enabled ? 'none' : 'block';
  if (disableBtn) disableBtn.style.display = enabled ? 'block' : 'none';
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeE2EE();
  updateE2EEStatus(false);
});
