// android-fastboot 库已经导出为全局变量：FastbootDevice, FastbootError, TimeoutError, UsbError, USER_ACTION_MAP, configureZip, setDebugLevel
function getFastbootLib() {
    return {
        FastbootDevice: typeof FastbootDevice !== 'undefined' ? FastbootDevice : null,
        FastbootError: typeof FastbootError !== 'undefined' ? FastbootError : null,
        TimeoutError: typeof TimeoutError !== 'undefined' ? TimeoutError : null,
        UsbError: typeof UsbError !== 'undefined' ? UsbError : null,
        USER_ACTION_MAP: typeof USER_ACTION_MAP !== 'undefined' ? USER_ACTION_MAP : null,
        configureZip: typeof configureZip !== 'undefined' ? configureZip : null,
        setDebugLevel: typeof setDebugLevel !== 'undefined' ? setDebugLevel : null
    };
}

// 全局变量
let adbTransport = null;
let adbDevice = null;
let fastbootDevice = null;
let androidFastbootDevice = null; // android-fastboot 库的设备实例
let connectedMode = null; // 'adb' 或 'fastboot'

// 线刷相关变量
let selectedFolder = null;
let imagesFolderHandle = null; // 刷机包文件夹句柄
let imagePackageName = ''; // 刷机包名称（用于显示路径）
let packageInfo = null;
let imageFiles = [];
let isFlashMode = false; // 是否在线刷模式
let isFlashing = false; // 是否正在刷入
let fastbootCheckInterval = null; // Fastboot检查定时器

// 日志功能 - 输出到控制台
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;

    const styles = {
        info: 'color: #4fc1ff; font-weight: 400;',
        success: 'color: #4ec9b0; font-weight: 500;',
        error: 'color: #f48771; font-weight: 500;',
        warning: 'color: #dcdcaa; font-weight: 500;'
    };

    console.log(`%c${logMessage}`, styles[type] || styles.info);
}

// iOS 风格页面切换动画辅助函数
let isAnimating = false;

function animatePageTransition(fromElement, toElement, direction = 'forward') {
    if (isAnimating) return;
    isAnimating = true;

    const exitClass = direction === 'forward' ? 'page-exit' : 'page-exit-back';
    const enterClass = direction === 'forward' ? 'page-enter' : 'page-enter-back';

    // 添加退出动画
    fromElement.classList.add(exitClass);

    // 等待退出动画开始
    setTimeout(() => {
        // 隐藏退出元素
        fromElement.style.display = 'none';
        fromElement.classList.remove(exitClass);

        // 显示并添加进入动画
        if (toElement.id === 'main-grid') {
            toElement.style.display = 'grid';
        } else {
            toElement.style.display = 'block';
        }
        toElement.classList.add(enterClass);

        // 动画结束后清理
        setTimeout(() => {
            toElement.classList.remove(enterClass);
            isAnimating = false;
        }, 500);
    }, 300);
}

// 显示授权弹窗
function showAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    log('显示授权提示弹窗', 'info');
}

// 隐藏授权弹窗
function hideAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
    log('隐藏授权提示弹窗', 'info');
}

// 更新连接状态
function updateConnectionStatus(connected) {
    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    
    if (connected) {
        statusBadge.classList.add('connected');
        statusText.textContent = connectedMode === 'adb' ? 'ADB' : 'Fastboot';
        connectBtn.disabled = true;
        connectBtn.querySelector('span').textContent = '已连接';
        disconnectBtn.disabled = false;
    } else {
        statusBadge.classList.remove('connected');
        statusText.textContent = '未连接';
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = '连接设备';
        disconnectBtn.disabled = true;
    }
}

// 更新设备操作按钮状态
function updateActionButtons(connected) {
    const buttons = ['reboot-btn', 'reboot-fastboot-btn', 'reboot-recovery-btn'];
    buttons.forEach(id => {
        document.getElementById(id).disabled = !connected;
    });
}

// 解析 ADB banner 信息
function parseAdbBanner(banner) {
    const info = {
        device: '未知',
        product: '未知',
        model: '未知',
        features: []
    };

    if (!banner) return info;

    // 格式: ro.product.name=X;ro.product.model=Y;ro.product.device=Z;features=A,B,C
    const pairs = banner.split(';');
    
    pairs.forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value) {
            switch(key) {
                case 'ro.product.device':
                    info.device = value;
                    break;
                case 'ro.product.name':
                    info.product = value;
                    break;
                case 'ro.product.model':
                    info.model = value;
                    break;
                case 'features':
                    info.features = value.split(',');
                    break;
            }
        }
    });

    return info;
}

// 显示设备信息
function showDeviceInfo(banner, mode) {
    const deviceDetails = document.getElementById('device-details');
    
    let deviceInfo = {
        device: '未知',
        product: '未知',
        model: '未知',
        features: []
    };
    
    if (mode === 'adb' && banner) {
        deviceInfo = parseAdbBanner(banner);
    }
    
    const html = `
        <div class="device-info-content">
            <div class="device-info-row">
                <span class="device-info-label">连接模式</span>
                <span class="device-info-value">${mode === 'adb' ? 'ADB' : 'Fastboot'}</span>
            </div>
            ${mode === 'adb' ? `
            <div class="device-info-row">
                <span class="device-info-label">设备代号</span>
                <span class="device-info-value">${deviceInfo.device}</span>
            </div>
            <div class="device-info-row">
                <span class="device-info-label">设备型号</span>
                <span class="device-info-value">${deviceInfo.model}</span>
            </div>
            ` : `
            <div class="device-info-row">
                <span class="device-info-label">设备代号</span>
                <span class="device-info-value">Fastboot</span>
            </div>
            <div class="device-info-row">
                <span class="device-info-label">设备型号</span>
                <span class="device-info-value">-</span>
            </div>
            `}
            <div class="device-info-row">
                <span class="device-info-label">连接时间</span>
                <span class="device-info-value">${new Date().toLocaleTimeString()}</span>
            </div>
        </div>
    `;
    
    deviceDetails.innerHTML = html;
    
    log('设备信息:', 'info');
    log(`  模式: ${mode === 'adb' ? 'ADB' : 'Fastboot'}`, 'info');
    if (mode === 'adb') {
        log(`  设备代号: ${deviceInfo.device}`, 'info');
        log(`  设备型号: ${deviceInfo.model}`, 'info');
        if (deviceInfo.features.length > 0) {
            log(`  支持功能: ${deviceInfo.features.join(', ')}`, 'info');
        }
    }
}

// 隐藏设备信息
function hideDeviceInfo() {
    const deviceDetails = document.getElementById('device-details');
    deviceDetails.innerHTML = `
        <div class="device-placeholder">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1">
                <rect x="5" y="2" width="14" height="20" rx="2"/>
            </svg>
            <p>暂无连接设备</p>
        </div>
    `;
}

// 检测设备类型
function detectDeviceType(device) {
    for (let i in device.configurations) {
        let conf = device.configurations[i];
        for (let j in conf.interfaces) {
            let intf = conf.interfaces[j];
            for (let k in intf.alternates) {
                let alt = intf.alternates[k];
                // 检测 ADB 接口 (classCode: 255, subclassCode: 66, protocolCode: 1)
                if (alt.interfaceClass === 255 && 
                    alt.interfaceSubclass === 66 && 
                    alt.interfaceProtocol === 1) {
                    return 'adb';
                }
                // 检测 Fastboot 接口 (classCode: 255, subclassCode: 66, protocolCode: 3)
                if (alt.interfaceClass === 255 && 
                    alt.interfaceSubclass === 66 && 
                    alt.interfaceProtocol === 3) {
                    return 'fastboot';
                }
            }
        }
    }
    return null;
}

// 自动连接设备
async function autoConnect() {
    try {
        log('========================================', 'info');
        log('正在搜索设备...', 'info');
        
        // 请求用户选择设备
        const device = await navigator.usb.requestDevice({
            filters: [
                { classCode: 255, subclassCode: 66, protocolCode: 1 }, // ADB
                { classCode: 255, subclassCode: 66, protocolCode: 3 }  // Fastboot
            ]
        });
        
        // 检测设备类型
        const deviceType = detectDeviceType(device);
        
        if (!deviceType) {
            log('未检测到 ADB 或 Fastboot 设备', 'error');
            throw new Error('未检测到支持的设备');
        }
        
        log(`检测到 ${deviceType.toUpperCase()} 设备`, 'info');
        log('正在打开设备...', 'info');
        
        // 打开设备
        await device.open();
        
        // 创建传输对象
        adbTransport = new Adb.WebUSB.Transport(device);
        
        if (deviceType === 'adb') {
            log('正在建立 ADB 连接...', 'info');
            adbDevice = await adbTransport.connectAdb("webadb::", function() {
                log('请在设备上确认授权', 'warning');
                showAuthModal();
            });
            
            connectedMode = 'adb';
            log('========================================', 'success');
            log('ADB 连接成功！', 'success');
            log(`最大负载: ${adbDevice.max_payload} bytes`, 'info');
            
            hideAuthModal();
            showDeviceInfo(adbDevice.banner, 'adb');
            updateActionButtons(true);
            updateConnectionStatus(true);
            
        } else {
            log('正在建立 Fastboot 连接...', 'info');
            fastbootDevice = await adbTransport.connectFastboot();
            
            connectedMode = 'fastboot';
            log('========================================', 'success');
            log('Fastboot 连接成功！', 'success');
            
            showDeviceInfo('fastboot:bootloader', 'fastboot');
            updateActionButtons(true);
            updateConnectionStatus(true);
        }
        
    } catch (error) {
        log('========================================', 'error');
        log(`连接失败: ${error.message}`, 'error');
        updateActionButtons(false);
        updateConnectionStatus(false);
        hideDeviceInfo();
        hideAuthModal();
        adbTransport = null;
        adbDevice = null;
        fastbootDevice = null;
        connectedMode = null;
    }
}

// 断开连接
async function disconnect() {
    log('========================================', 'info');
    log('正在断开连接...', 'warning');
    
    try {
        if (adbTransport && adbTransport.device) {
            await adbTransport.device.close();
        }
        
        adbTransport = null;
        adbDevice = null;
        fastbootDevice = null;
        connectedMode = null;
        
        updateActionButtons(false);
        updateConnectionStatus(false);
        hideDeviceInfo();
        
        log('已断开连接', 'success');
        log('========================================', 'success');
        
    } catch (error) {
        log(`断开连接时出错: ${error.message}`, 'error');
    }
}

// 重启设备
async function rebootDevice(command = "") {
    if (!adbDevice) {
        log('设备未连接', 'error');
        return;
    }
    
    try {
        const cmdName = command ? `重启到 ${command}` : '重启设备';
        log(`========================================`, 'info');
        log(`正在执行: ${cmdName}...`, 'warning');
        
        await adbDevice.reboot(command);
        
        log(`${cmdName} 命令已发送`, 'success');
        log('========================================', 'success');
        
        // 设备断开后禁用按钮
        updateActionButtons(false);
        updateConnectionStatus(false);
        hideDeviceInfo();
        
        adbDevice = null;
        connectedMode = null;
        document.getElementById('connect-btn').querySelector('span').textContent = '连接设备';
        
    } catch (error) {
        log(`重启失败: ${error.message}`, 'error');
    }
}

// 重启到 Fastboot
async function rebootToFastboot() {
    if (!adbDevice) {
        log('设备未连接', 'error');
        return;
    }
    
    try {
        log('========================================', 'info');
        log('正在重启到 Fastboot 模式...', 'warning');
        
        await adbDevice.rebootToFastboot();
        
        log('Fastboot 重启命令已发送', 'success');
        log('========================================', 'success');
        
        updateActionButtons(false);
        updateConnectionStatus(false);
        hideDeviceInfo();
        
        adbDevice = null;
        connectedMode = null;
        document.getElementById('connect-btn').querySelector('span').textContent = '连接设备';
        
        log('请等待设备重启后点击"连接设备"', 'warning');
        
    } catch (error) {
        log(`重启到 Fastboot 失败: ${error.message}`, 'error');
    }
}

// 事件监听
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否首次加载
    const isFirstLoad = !localStorage.getItem('webMiFlashFirstLoaded');
    const loadingScreen = document.getElementById('loading-screen');

    if (isFirstLoad) {
        // 首次加载，显示加载动画并标记
        localStorage.setItem('webMiFlashFirstLoaded', 'true');
        setTimeout(() => {
            loadingScreen.classList.add('loaded');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 800);
        }, 4000);
    } else {
        // 非首次加载，直接隐藏加载屏
        loadingScreen.style.display = 'none';
    }

    // 检查浏览器支持
    if (!navigator.usb) {
        log('您的浏览器不支持 WebUSB，请使用 Chrome 或 Edge', 'error');
        document.getElementById('connect-btn').disabled = true;
        return;
    }

    // 等待加载动画完成后再显示提示信息
    setTimeout(() => {
        const infoToast = document.getElementById('info-toast');
        if (infoToast) {
            infoToast.style.display = 'block';
        }
    }, isFirstLoad ? 4200 : 100); // 首次加载4.2秒，刷新立即显示

    // 版本信息弹窗
    document.getElementById('app-logo').addEventListener('click', () => {
        document.getElementById('version-modal').style.display = 'flex';
    });

    document.getElementById('version-modal-close').addEventListener('click', () => {
        document.getElementById('version-modal').style.display = 'none';
    });

    // 连接按钮
    document.getElementById('connect-btn').addEventListener('click', autoConnect);
    
    // 断开连接按钮
    document.getElementById('disconnect-btn').addEventListener('click', disconnect);
    
    // 重启按钮
    document.getElementById('reboot-btn').addEventListener('click', () => rebootDevice());
    
    // 重启到 Fastboot 按钮
    document.getElementById('reboot-fastboot-btn').addEventListener('click', rebootToFastboot);
    
    // 重启到 Recovery 按钮
    document.getElementById('reboot-recovery-btn').addEventListener('click', () => rebootDevice('recovery'));
    
    // 线刷模式按钮
    document.getElementById('flash-mode-btn').addEventListener('click', toggleFlashMode);

    // 线刷相关按钮
    document.getElementById('header-back-btn').addEventListener('click', toggleFlashMode);
    document.getElementById('flash-start-btn').addEventListener('click', startFlash);
    document.getElementById('flash-select-confirm').addEventListener('click', confirmSelectFlash);
    document.getElementById('flash-select-cancel').addEventListener('click', cancelSelectFlash);
    document.getElementById('flash-hint-confirm').addEventListener('click', confirmFlashHint);

    // 进度条相关按钮
    document.getElementById('details-toggle').addEventListener('click', toggleDetails);
    document.getElementById('back-to-flash-btn').addEventListener('click', returnToFlashAfterProgress);

    // 小米确认弹窗相关按钮
    document.getElementById('mi-flash-cancel').addEventListener('click', closeMiFlashConfirm);
    document.getElementById('mi-flash-continue').addEventListener('click', executeFlashProcess);
    document.getElementById('start-flash-from-fastboot-btn').addEventListener('click', startFlashFromFastboot);
    
    // 提示按钮
    const infoBtn = document.getElementById('info-btn');
    const infoToast = document.getElementById('info-toast');
    const infoToastClose = document.getElementById('info-toast-close');
    
    infoBtn.addEventListener('click', () => {
        infoToast.style.display = 'block';
    });
    
    infoToastClose.addEventListener('click', () => {
        infoToast.style.display = 'none';
    });
    
    // 点击外部关闭提示
    document.addEventListener('click', (e) => {
        if (!infoToast.contains(e.target) && !infoBtn.contains(e.target)) {
            infoToast.style.display = 'none';
        }
    });
    
    // 初始化日志
    log('========================================', 'info');
    log('WEB 小米线刷工具 v1.0', 'success');
    log('========================================', 'info');
    log('工具已准备就绪', 'success');
    log('支持自动检测 ADB 和 Fastboot 设备', 'info');
    log('请确保 Android 设备已启用 USB 调试模式', 'info');
    log('========================================', 'info');
});

// ==================== 线刷功能相关函数 ====================

// 切换线刷模式
function toggleFlashMode() {
    const mainGrid = document.getElementById('main-grid');
    const flashContainer = document.getElementById('flash-container');
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const appTitle = document.getElementById('app-title');
    const headerBackBtn = document.getElementById('header-back-btn');
    const flashSelectModal = document.getElementById('flash-select-modal');

    isFlashMode = !isFlashMode;

    if (isFlashMode) {
        // 显示提示弹窗
        flashSelectModal.style.display = 'flex';
    } else {
        // 判断当前显示的容器，执行相应的退出动画
        const currentContainer = flashContainer.style.display !== 'none' ? flashContainer :
                            fastbootCheckContainer.style.display !== 'none' ? fastbootCheckContainer : null;

        if (currentContainer) {
            animatePageTransition(currentContainer, mainGrid, 'back');
        } else {
            mainGrid.style.display = 'grid';
        }

        flashContainer.style.display = 'none';
        fastbootCheckContainer.style.display = 'none';
        appTitle.textContent = 'WEB 小米线刷工具';
        headerBackBtn.style.display = 'none';
        log('返回主界面', 'info');

        // 停止Fastboot检查
        stopFastbootCheck();
    }
}

// 确认选择线刷包
function confirmSelectFlash() {
    const flashSelectModal = document.getElementById('flash-select-modal');
    const mainGrid = document.getElementById('main-grid');
    const flashContainer = document.getElementById('flash-container');
    const appTitle = document.getElementById('app-title');
    const headerBackBtn = document.getElementById('header-back-btn');

    flashSelectModal.style.display = 'none';

    // 使用页面切换动画
    animatePageTransition(mainGrid, flashContainer, 'forward');

    appTitle.textContent = '线刷包刷写';
    headerBackBtn.style.display = 'flex';
    log('进入线刷模式', 'info');
    // 自动弹出文件夹选择
    selectFolder();
}

// 取消选择线刷包
function cancelSelectFlash() {
    const flashSelectModal = document.getElementById('flash-select-modal');
    flashSelectModal.style.display = 'none';
    isFlashMode = false;
}

// 确认刷入提示，进入Fastboot检查卡片
function confirmFlashHint() {
    const hintModal = document.getElementById('flash-hint-modal');
    hintModal.style.display = 'none';

    // 切换到Fastboot检查卡片
    showFastbootCheckCard();
    log('进入 Fastboot 状态检查', 'info');
}

// 关闭小米确认弹窗
function closeMiFlashConfirm() {
    const modal = document.getElementById('flash-confirm-modal');
    modal.style.display = 'none';
    modal.classList.remove('modal-visible');
    // 重置按钮状态
    const flashBtn = document.getElementById('flash-start-btn');
    if (flashBtn) {
        flashBtn.disabled = false;
        flashBtn.querySelector('span').textContent = '开始刷入';
    }
}

// 显示Fastboot检查卡片
function showFastbootCheckCard() {
    const flashContainer = document.getElementById('flash-container');
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const appTitle = document.getElementById('app-title');

    log('[DEBUG] showFastbootCheckCard 被调用', 'info');
    log('[DEBUG] flashContainer display:', flashContainer?.style.display, 'info');
    log('[DEBUG] fastbootCheckContainer display:', fastbootCheckContainer?.style.display, 'info');
    log('[DEBUG] isFlashing:', isFlashing, 'info');

    // 使用页面切换动画
    animatePageTransition(flashContainer, fastbootCheckContainer, 'forward');

    appTitle.textContent = 'Fastboot 检查';

    // 开始定时检查Fastboot状态
    startFastbootCheck();
}

// 开始检查Fastboot状态
async function startFastbootCheck() {
    const statusIcon = document.getElementById('fastboot-status-icon');
    const statusText = document.getElementById('fastboot-status-text');

    // 立即执行第一次检查
    setTimeout(async () => {
        await checkFastbootDevice(statusIcon, statusText);
    }, 100);

    // 每5秒检查一次
    fastbootCheckInterval = setInterval(async () => {
        await checkFastbootDevice(statusIcon, statusText);
    }, 5000);
}

// 检查Fastboot设备
async function checkFastbootDevice(statusIcon, statusText) {
    try {
        // 如果正在刷入,立即停止定时器,隐藏检查页面并返回
        if (isFlashing) {
            log('检测到正在刷入状态,停止 Fastboot 检查', 'info');

            // 停止定时器
            if (fastbootCheckInterval) {
                clearInterval(fastbootCheckInterval);
                fastbootCheckInterval = null;
            }

            // 确保隐藏 Fastboot 检查页面,显示进度页面
            const fastbootCheckContainer = document.getElementById('fastboot-check-container');
            const progressContainer = document.getElementById('flash-progress-container');
            const appTitle = document.getElementById('app-title');

            if (fastbootCheckContainer) {
                const display = window.getComputedStyle(fastbootCheckContainer).display;
                if (display !== 'none') {
                    fastbootCheckContainer.style.display = 'none';
                    log('已隐藏 Fastboot 检查页面', 'info');
                }
            }

            if (progressContainer) {
                const display = window.getComputedStyle(progressContainer).display;
                if (display === 'none') {
                    progressContainer.style.display = 'block';
                    log('已显示刷入进度页面', 'info');
                }
            }

            if (appTitle) {
                appTitle.textContent = '刷入进度';
            }

            return;
        }

        // 如果定时器已被清除,直接返回
        if (!fastbootCheckInterval) {
            return;
        }

        // 只在第一次检查时输出日志
        if (!fastbootDevice) {
            log('正在检查 Fastboot 连接...', 'info');
        }

        // 尝试检测Fastboot设备
        const devices = await navigator.usb.getDevices();
        let foundFastboot = false;

        for (const device of devices) {
            const deviceType = detectDeviceType(device);
            if (deviceType === 'fastboot') {
                foundFastboot = true;
                log(`检测到 Fastboot 设备: ${device.productName || '未知'}`, 'success');

                // 完全重置设备状态
                try {
                    // 如果设备已打开，先关闭所有接口
                    if (device.opened) {
                        log('设备已打开，正在关闭...', 'warning');
                        try {
                            await device.close();
                            // 延迟更长时间以确保设备完全释放
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            log('设备已关闭', 'info');
                        } catch (e) {
                            log(`关闭设备时出错: ${e.message}`, 'warning');
                        }
                    }

                    // 打开设备 - 使用 try-catch 捕获 Access denied
                    log('正在打开设备...', 'info');
                    await device.open();
                    log('设备已打开', 'success');

                    // 选择配置
                    try {
                        const config = device.configurations[0];
                        if (config) {
                            await device.selectConfiguration(config.configurationValue);
                            log(`已选择配置: ${config.configurationValue}`, 'info');
                        }
                    } catch (e) {
                        log(`选择配置失败: ${e.message}`, 'warning');
                        // 配置选择失败不是致命错误，继续
                    }

                    // 声明接口 - 找到正确的接口
                    try {
                        const config = device.configuration;
                        if (config && config.interfaces) {
                            // Fastboot 通常使用接口 0
                            for (const iface of config.interfaces) {
                                const ifaceNumber = iface.interfaceNumber;
                                try {
                                    await device.claimInterface(ifaceNumber);
                                    log(`已声明接口 ${ifaceNumber}`, 'info');
                                } catch (e) {
                                    log(`声明接口 ${ifaceNumber} 失败: ${e.message}`, 'warning');
                                }
                            }
                        }
                    } catch (e) {
                        log(`声明接口时出错: ${e.message}`, 'warning');
                        // 继续尝试，Transport 可能能自动处理
                    }

                } catch (openError) {
                    if (openError.message.includes('Access denied') || openError.name === 'SecurityError') {
                        log('连接失败: Access denied', 'error');
                        log('========================================', 'error');
                        log('设备访问被拒绝', 'error');
                        log('', 'error');
                        log('【解决方法】', 'success');
                        log('请按顺序尝试以下步骤:', 'warning');
                        log('  1. 完全关闭浏览器（所有窗口）', 'warning');
                        log('  2. 确保 ADB 命令行已关闭（运行: adb kill-server）', 'warning');
                        log('  3. 重新打开浏览器', 'warning');
                        log('  4. 刷新页面', 'warning');
                        log('  5. 如果仍然失败，尝试更换 USB 端口', 'warning');
                        log('', 'error');
                        log('【技术说明】', 'info');
                        log('WebUSB 协议同一时间只能被一个页面访问', 'info');
                        log('如果其他标签页已打开此设备，需要关闭那些标签页', 'info');
                        log('========================================', 'error');
                        continue; // 尝试下一个设备
                    }
                    throw openError;
                }

                try {
                    adbTransport = new Adb.WebUSB.Transport(device);
                    fastbootDevice = await adbTransport.connectFastboot();
                    connectedMode = 'fastboot';
                    log('Fastboot 连接已建立', 'success');

                    // connectFastboot 已经验证了连接，直接获取设备信息
                    try {
                        // 使用 android-fastboot 获取设备信息
                        const fbLib = getFastbootLib();
                        const fb = new fbLib.FastbootDevice();
                        await fb.connect();
                        const product = await fb.getVariable('product');
                        const serialno = await fb.getVariable('serialno');
                        log(`设备型号: ${product || '未知'}`, 'info');
                        log(`设备序列号: ${serialno || '未知'}`, 'info');

                        // 更新导航栏连接状态
                        updateActionButtons(true);
                        updateConnectionStatus(true);

                        // 立即设置刷入标志，防止其他定时器回调执行
                        isFlashing = true;

                        // 立即停止检查定时器
                        clearInterval(fastbootCheckInterval);
                        fastbootCheckInterval = null;

                        // 立即隐藏 Fastboot 检查页面
                        const fastbootCheckContainer = document.getElementById('fastboot-check-container');
                        if (fastbootCheckContainer) {
                            const display = window.getComputedStyle(fastbootCheckContainer).display;
                            if (display !== 'none') {
                                fastbootCheckContainer.style.display = 'none';
                                log('已隐藏 Fastboot 检查页面', 'info');
                            }
                        }

                        // 连接成功后直接开始刷入
                        log('Fastboot 连接成功，准备开始刷入...', 'success');
                        await startFlashFromFastboot();
                        return; // 退出函数,避免继续执行后续代码
                        break;
                    } catch (getInfoError) {
                        log(`获取设备信息失败: ${getInfoError.message}`, 'warning');
                        log('但连接已建立，可以开始刷入', 'info');

                        // 更新导航栏连接状态
                        updateActionButtons(true);
                        updateConnectionStatus(true);

                        // 立即设置刷入标志，防止其他定时器回调执行
                        isFlashing = true;

                        // 立即停止检查定时器
                        clearInterval(fastbootCheckInterval);
                        fastbootCheckInterval = null;

                        // 立即隐藏 Fastboot 检查页面
                        const fastbootCheckContainer = document.getElementById('fastboot-check-container');
                        if (fastbootCheckContainer) {
                            const display = window.getComputedStyle(fastbootCheckContainer).display;
                            if (display !== 'none') {
                                fastbootCheckContainer.style.display = 'none';
                                log('已隐藏 Fastboot 检查页面', 'info');
                            }
                        }

                        // 连接成功后直接开始刷入
                        log('Fastboot 连接成功，准备开始刷入...', 'success');
                        await startFlashFromFastboot();
                        return; // 退出函数,避免继续执行后续代码
                        break;
                    }
                } catch (transportError) {
                    log(`创建 Fastboot 连接失败: ${transportError.message}`, 'error');
                    // 清理
                    try {
                        if (device.opened) {
                            await device.close();
                        }
                    } catch (e) {
                        // 忽略关闭错误
                    }
                }
            }
        }

        if (!foundFastboot) {
            log('未在已授权设备中找到 Fastboot 设备', 'warning');
            log('提示: 请确保设备已进入 Fastboot 模式', 'info');
            log('快捷键: 关机后同时按住 电源键 + 音量减键', 'info');

            // 尝试请求 Fastboot 设备
            try {
                log('正在请求 Fastboot 设备授权...', 'info');
                const requestedDevice = await navigator.usb.requestDevice({
                    filters: [
                        { classCode: 255, subclassCode: 66, protocolCode: 3 }  // Fastboot
                    ]
                });

                if (requestedDevice) {
                    log(`用户选择了设备: ${requestedDevice.productName || '未知'}`, 'success');
                    // 设备已授权,下一次检查应该能找到
                    // 立即执行一次检查（检查 isFlashing 状态）
                    setTimeout(() => {
                        // 检查是否已经开始刷写，如果是则不执行
                        if (isFlashing) {
                            log('检测到正在刷入，跳过设备检查', 'info');
                            return;
                        }
                        checkFastbootDevice(statusIcon, statusText);
                    }, 500);
                }
            } catch (requestError) {
                if (requestError.name === 'NotFoundError') {
                    log('用户取消了设备选择', 'info');
                } else {
                    log(`请求设备失败: ${requestError.message}`, 'error');
                }
            }
        }

    } catch (error) {
        log(`检查 Fastboot 状态失败: ${error.message}`, 'error');

        if (error.message.includes('Access denied') || error.name === 'SecurityError') {
            log('========================================', 'error');
            log('【设备访问被拒绝】', 'error');
            log('========================================', 'error');
            log('可能原因:', 'error');
            log('  1. 设备被其他程序占用（ADB、MiFlash 等）', 'error');
            log('  2. 其他浏览器标签页已打开此设备', 'error');
            log('  3. 设备驱动程序问题', 'error');
            log('', 'error');
            log('【解决步骤】', 'success');
            log('步骤 1: 关闭所有 ADB/Fastboot 程序', 'warning');
            log('  - 打开命令行运行: adb kill-server', 'warning');
            log('  - 关闭所有 MiFlash、MiUnlock 等工具', 'warning');
            log('', 'warning');
            log('步骤 2: 关闭浏览器', 'warning');
            log('  - 关闭所有 Chrome/Edge 窗口', 'warning');
            log('  - 确保没有后台进程运行', 'warning');
            log('', 'warning');
            log('步骤 3: 重新打开', 'warning');
            log('  - 打开浏览器', 'warning');
            log('  - 访问 chrome://usb-devices 检查设备状态', 'warning');
            log('  - 刷新本页面', 'warning');
            log('', 'warning');
            log('步骤 4: 如果仍然失败', 'warning');
            log('  - 更换 USB 端口', 'warning');
            log('  - 更换 USB 数据线', 'warning');
            log('========================================', 'error');
        }
    }
}

// 返回刷入模式
function returnToFlashMode() {
    const flashContainer = document.getElementById('flash-container');
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const appTitle = document.getElementById('app-title');
    const checkActions = document.getElementById('fastboot-check-actions');

    fastbootCheckContainer.style.display = 'none';
    flashContainer.style.display = 'block';
    appTitle.textContent = '线刷包刷写';

    // 隐藏开始按钮
    if (checkActions) {
        checkActions.style.display = 'none';
    }

    updateConnectionStatus(true);
    log('已连接 Fastboot，准备刷入', 'success');
}

// 显示 Fastboot 开始按钮
function showStartFlashButton() {
    const checkActions = document.getElementById('fastboot-check-actions');
    if (checkActions) {
        checkActions.style.display = 'block';
    }
}

// 停止Fastboot检查
function stopFastbootCheck() {
    if (fastbootCheckInterval) {
        clearInterval(fastbootCheckInterval);
        fastbootCheckInterval = null;
        log('停止 Fastboot 状态检查', 'info');
    }
}

// 解析 misc.txt 文件内容
function parseMiscTxt(content) {
    const info = {
        device: '未知',
        build_number: '未知',
        userdata_version: '未知'
    };
    
    if (!content) return info;
    
    const lines = content.split('\n');
    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('device=')) {
            info.device = line.substring(7);
        } else if (line.startsWith('build_number=')) {
            info.build_number = line.substring(13);
        } else if (line.startsWith('userdata_version=')) {
            info.userdata_version = line.substring(17);
        }
    });
    
    return info;
}

// 显示刷机包信息
function showFlashPackageInfo(info) {
    const flashInfoContent = document.getElementById('flash-info-content');
    
    const html = `
        <div class="flash-info-content">
            <div class="flash-info-row">
                <span class="flash-info-label">机型</span>
                <span class="flash-info-value">${info.device}</span>
            </div>
            <div class="flash-info-row">
                <span class="flash-info-label">系统版本</span>
                <span class="flash-info-value">${info.build_number}</span>
            </div>
            <div class="flash-info-row">
                <span class="flash-info-label">更新日期</span>
                <span class="flash-info-value">${info.userdata_version}</span>
            </div>
            <div class="flash-info-row">
                <span class="flash-info-label">镜像数量</span>
                <span class="flash-info-value">${imageFiles.length} 个</span>
            </div>
        </div>
    `;
    
    flashInfoContent.innerHTML = html;
    log('刷机包信息:', 'info');
    log(`  机型: ${info.device}`, 'info');
    log(`  系统版本: ${info.build_number}`, 'info');
    log(`  更新日期: ${info.userdata_version}`, 'info');
}

// 显示镜像文件列表
function showFlashImageList(files) {
    const imageList = document.getElementById('flash-image-list');
    const imageCountEl = document.getElementById('flash-image-count');
    
    const html = `
        <div class="image-list-content">
            ${files.map(file => `
                <div class="image-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    <span>${file.name}</span>
                    <span class="image-size">${formatFileSize(file.size)}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    imageList.innerHTML = html;
    log(`找到 ${files.length} 个镜像文件`, 'info');

    if (imageCountEl) {
        imageCountEl.textContent = `${files.length} 个文件`;
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 选择文件夹
async function selectFolder() {
    try {
        log('========================================', 'info');
        log('正在选择线刷包文件夹...', 'info');
        
        const dirHandle = await window.showDirectoryPicker({
            mode: 'read',
            startIn: 'documents'
        });

        selectedFolder = dirHandle;
        imagesFolderHandle = dirHandle; // 保存文件夹句柄
        imagePackageName = dirHandle.name; // 保存刷机包名称
        imageFiles = [];
        packageInfo = null;

        // 查找 images 文件夹
        let imagesFolder = null;
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory' && entry.name.toLowerCase() === 'images') {
                imagesFolder = entry;
                break;
            }
        }

        if (!imagesFolder) {
            log('未找到 images 文件夹，直接扫描根目录...', 'warning');
            await scanImagesFolder(dirHandle);
        } else {
            log('找到 images 文件夹', 'success');
            await scanImagesFolder(imagesFolder);
        }
        
        // 查找 misc.txt 文件
        let miscFile = null;
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase() === 'misc.txt') {
                miscFile = entry;
                break;
            }
        }
        
        if (miscFile) {
            log('找到 misc.txt 文件', 'success');
            const miscFileHandle = await dirHandle.getFileHandle('misc.txt');
            const file = await miscFileHandle.getFile();
            const content = await file.text();
            packageInfo = parseMiscTxt(content);
            showFlashPackageInfo(packageInfo);
        } else {
            log('未找到 misc.txt 文件', 'warning');
            packageInfo = {
                device: '未知',
                build_number: '未知',
                userdata_version: '未知'
            };
            showFlashPackageInfo(packageInfo);
        }
        
        // 更新刷入按钮状态
        updateFlashStartButton();
        
        log('========================================', 'success');
        
    } catch (error) {
        log(`选择文件夹失败: ${error.message}`, 'error');
    }
}

// 扫描镜像文件
async function scanImagesFolder(folderHandle) {
    imageFiles = [];
    
    for await (const entry of folderHandle.values()) {
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            const imgExtensions = ['.img', '.bin', '.mbn'];
            const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
            
            if (imgExtensions.includes(ext)) {
                imageFiles.push({
                    name: file.name,
                    size: file.size,
                    handle: entry
                });
            }
        }
    }
    
    if (imageFiles.length > 0) {
        imageFiles.sort((a, b) => a.name.localeCompare(b.name));
        showFlashImageList(imageFiles);
    } else {
        const imageList = document.getElementById('flash-image-list');
        const imageCountEl = document.getElementById('flash-image-count');

        if (imageList) {
            imageList.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <p>未找到镜像文件</p>
                </div>
            `;
        }

        if (imageCountEl) {
            imageCountEl.textContent = '0 个文件';
        }

        log('未找到镜像文件', 'warning');
    }
}

// 更新刷入按钮状态
function updateFlashStartButton() {
    const flashBtn = document.getElementById('flash-start-btn');
    const hasPackageInfo = packageInfo !== null && packageInfo.device !== '未知';
    
    flashBtn.disabled = !hasPackageInfo;
}

// 开始刷入 - 显示确认弹窗
async function startFlash() {
    console.log('[DEBUG] startFlash 被调用');

    if (!packageInfo || packageInfo.device === '未知') {
        log('无法读取刷机包信息', 'error');
        alert('无法读取刷机包信息');
        return;
    }

    if (imageFiles.length === 0) {
        log('未找到镜像文件', 'error');
        alert('未找到镜像文件');
        return;
    }

    // 获取刷入模式
    const flashMode = document.querySelector('input[name="flash-mode"]:checked').value;
    const modeText = flashMode === 'format' ? '格式化刷入' : '保留数据刷入';

    // 填充弹窗信息
    document.getElementById('mi-confirm-device').textContent = packageInfo.device;
    document.getElementById('mi-confirm-mode').textContent = modeText;
    document.getElementById('mi-confirm-count').textContent = `${imageFiles.length} 个`;

    // 显示弹窗
    const modal = document.getElementById('flash-confirm-modal');
    modal.style.display = 'flex';
    modal.classList.add('modal-visible');

    // 尝试 ADB 重启到 Fastboot
    const statusEl = document.getElementById('mi-modal-status');
    const continueBtn = document.getElementById('mi-flash-continue');
    const statusText = statusEl.querySelector('.status-text');

    // 显示状态区域
    statusEl.style.display = 'flex';

    statusText.textContent = '正在尝试 ADB 重启到 Fastboot...';
    statusEl.className = 'flash-confirm-status';
    continueBtn.disabled = true;

    try {
        // 检查 ADB 连接状态
        if (adbDevice && connectedMode === 'adb') {
            log('已连接 ADB，正在重启到 Fastboot...', 'info');
            await adbDevice.reboot('bootloader');
            statusEl.className = 'flash-confirm-status success';
            statusText.textContent = '✓ 已发送重启命令，正在进入 Fastboot 状态检查...';
            continueBtn.disabled = true;

            // ADB 重启命令发送成功后，自动进入 Fastboot 状态检查页面
            await executeFlashProcess();

        } else {
            // 未连接 ADB，提示手动重启
            statusEl.className = 'flash-confirm-status error';
            statusText.textContent = '未检测到 ADB 连接，请手动重启到 Fastboot 模式';
            continueBtn.disabled = false;
        }
    } catch (error) {
        log(`ADB 重启失败: ${error.message}`, 'error');
        statusEl.className = 'flash-confirm-status error';
        statusText.textContent = 'ADB 重启失败，请手动重启到 Fastboot 模式';
        continueBtn.disabled = false;
    }
}

// 执行刷入（用户点击继续后调用）
async function executeFlashProcess() {
    // 隐藏确认弹窗
    const modal = document.getElementById('flash-confirm-modal');
    modal.style.display = 'none';
    modal.classList.remove('modal-visible');

    // 进入 Fastboot 检查页面
    const flashContainer = document.getElementById('flash-container');
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const progressContainer = document.getElementById('flash-progress-container');
    const appTitle = document.getElementById('app-title');

    flashContainer.style.display = 'none';
    progressContainer.style.display = 'none';  // 确保进度页面是隐藏的
    fastbootCheckContainer.style.display = 'block';
    appTitle.textContent = '检查 Fastboot 连接';

    // 开始 Fastboot 检查
    showFastbootCheckCard();
}

// Fastboot 检查成功后，用户点击开始按钮执行刷写
async function startFlashFromFastboot() {
    // 立即设置正在刷入标志 - 必须在所有操作之前
    isFlashing = true;

    // 立即停止定时器,防止重复执行
    if (fastbootCheckInterval) {
        clearInterval(fastbootCheckInterval);
        fastbootCheckInterval = null;
        log('已停止 Fastboot 检查定时器', 'info');
    }

    // 确保隐藏 Fastboot 检查容器,显示进度容器（双重保险）
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const progressContainer = document.getElementById('flash-progress-container');
    const appTitle = document.getElementById('app-title');

    // 强制隐藏 Fastboot 检查容器
    if (fastbootCheckContainer) {
        const display = window.getComputedStyle(fastbootCheckContainer).display;
        if (display !== 'none') {
            fastbootCheckContainer.style.display = 'none';
            log('已隐藏 Fastboot 检查页面', 'info');
        }
    }

    // 强制显示进度容器
    if (progressContainer) {
        const display = window.getComputedStyle(progressContainer).display;
        if (display === 'none') {
            progressContainer.style.display = 'block';
            log('已显示刷入进度页面', 'info');
        }
    }

    if (appTitle && appTitle.textContent !== '刷入进度') {
        appTitle.textContent = '刷入进度';
    }

    const isFormat = document.querySelector('input[name="flash-mode"]:checked').value === 'format';
    const batFileName = isFormat ? 'flash_all.bat' : 'flash_all_except_storage.bat';
    const modeText = isFormat ? '格式化刷入' : '保留数据刷入';

    try {
        // 显示进度容器，隐藏前面的卡片
        showFlashProgressContainer();

        log('========================================', 'info');
        log('开始刷入...', 'warning');
        addProgressLog('═════════════════════════════════', 'info');
        addProgressLog('刷入流程开始', 'info');
        addProgressLog(`刷入模式: ${modeText}`, 'info');
        addProgressLog(`使用脚本: ${batFileName}`, 'info');
        addProgressLog(`═════════════════════════════════`, 'info');

        // 读取 bat 文件内容
        log(`正在读取 ${batFileName}...`, 'info');
        addProgressLog('正在读取刷机脚本...', 'info');
        const batContent = await readBatFile(batFileName);

        if (!batContent) {
            log(`无法读取 ${batFileName}`, 'error');
            alert(`无法读取 ${batFileName}，请确保文件存在`);
            return;
        }

        addProgressLog(`✓ 脚本读取成功: ${batFileName}`, 'success');

        // 创建 android-fastboot 设备实例
        const fbLib = getFastbootLib();
        const fb = new fbLib.FastbootDevice();
        await fb.connect();
        fbLib.setDebugLevel(2); // 开启详细日志

        // 检查设备型号（对应 bat 文件中的 fastboot %* getvar product）
        log('正在检查设备型号...', 'info');
        addProgressLog('正在检查设备型号...', 'info');
        let deviceProduct;
        try {
            deviceProduct = await fb.getVariable('product');
            log(`设备型号: ${deviceProduct}`, 'info');
            addProgressLog(`✓ 设备型号: ${deviceProduct}`, 'success');
        } catch (getvarError) {
            log(`获取设备型号失败: ${getvarError.message}`, 'warning');
            log('跳过设备型号检查，继续刷入...', 'warning');
            addProgressLog(`⚠ 获取设备型号失败，跳过检查`, 'warning');
            deviceProduct = null;
        }

        // 如果成功获取到设备型号，进行验证
        if (deviceProduct && deviceProduct !== packageInfo.device) {
            log('========================================', 'error');
            log('错误: 刷机包与设备不匹配', 'error');
            log(`设备型号: ${deviceProduct}`, 'error');
            log(`刷机包机型: ${packageInfo.device}`, 'error');
            log('========================================', 'error');
            alert(`设备型号不匹配\n设备: ${deviceProduct}\n刷机包: ${packageInfo.device}`);
            return;
        }

        // 验证刷机包与设备型号
        if (deviceProduct && packageInfo.device) {
            if (deviceProduct === packageInfo.device) {
                addProgressLog(`✓ 设备型号验证通过: ${deviceProduct}`, 'success');
            } else {
                addProgressLog(`⚠ 设备型号可能不匹配`, 'warning');
                addProgressLog(`  设备: ${deviceProduct}`, 'warning');
                addProgressLog(`  刷机包: ${packageInfo.device}`, 'warning');
            }
        }

        addProgressLog('═════════════════════════════════', 'info');
        addProgressLog('开始执行刷入命令', 'info');
        addProgressLog('═════════════════════════════════', 'info');

        log('准备刷入...', 'success');

        // 解析 bat 文件中的命令并执行
        await executeBatCommands(batContent, fb);

        // 显示结果
        log('========================================', 'info');
        log('刷入完成', 'info');

    } catch (error) {
        log(`刷入失败: ${error.message}`, 'error');
        addProgressLog(`═════════════════════════════════`, 'error');
        addProgressLog(`✗ 刷入失败: ${error.message}`, 'error');
        addProgressLog(`═════════════════════════════════`, 'error');
        if (error.stack) {
            log(`错误堆栈: ${error.stack}`, 'error');
        }
    } finally {
        const flashBtn = document.getElementById('flash-start-btn');
        flashBtn.disabled = false;
        flashBtn.querySelector('span').textContent = '开始刷入';
    }
}

// 读取 bat 文件
async function readBatFile(batFileName) {
    try {
        if (!imagesFolderHandle) {
            return null;
        }
        const batFileHandle = await imagesFolderHandle.getFileHandle(batFileName);
        const batFile = await batFileHandle.getFile();
        return await batFile.text();
    } catch (error) {
        console.error(`读取 bat 文件失败: ${error.message}`);
        return null;
    }
}

// 解析并执行 bat 文件中的命令
async function executeBatCommands(batContent, fb) {
    // 确保设置刷入标志（双重保险）
    isFlashing = true;

    log('[调试] executeBatCommands 开始执行', 'info');

    const lines = batContent.split('\n');
    log(`[调试] bat 文件共有 ${lines.length} 行`, 'info');

    let commandCount = 0;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    log('开始执行刷入命令...', 'warning');
    log('========================================', 'warning');

    // 初始化进度界面
    showFlashProgressContainer();
    updateProgressStatus('正在解析命令...');
    addProgressLog('正在解析刷机脚本命令...', 'info');

    // 先计算总命令数
    let totalCommands = 0;
    log('[调试] 开始计算总命令数...', 'info');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('::') && !trimmed.startsWith('REM') && !trimmed.startsWith('rem') &&
            !trimmed.includes('getvar product') && trimmed.match(/^fastboot\s+/)) {
            totalCommands++;
            log(`[调试] 计数命令: ${trimmed}`, 'info');
        }
    }

    log(`[调试] 总命令数: ${totalCommands}`, 'info');
    updateProgressStats(totalCommands, 0, 0);
    updateProgressStatus(`共 ${totalCommands} 个命令待执行`);
    addProgressLog(`解析完成: 发现 ${totalCommands} 个有效命令`, 'info');

    let currentCommand = 0;
    log('[调试] 开始遍历命令行...', 'info');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 跳过空行和注释
        if (!line || line.startsWith('::') || line.startsWith('REM') || line.startsWith('rem')) {
            continue;
        }

        // 跳过 getvar 检查（已经在前面执行过了）
        if (line.includes('getvar product')) {
            continue;
        }

        log(`[调试] 处理第 ${i} 行: ${line}`, 'info');

        // 解析 fastboot 命令
        // 格式: fastboot %* <command> <partition> [path] || ...
        // 或者: fastboot %* -w || ...
        // 提取命令部分，不包括文件路径
        let command;

        // 移除 fastboot %* 前缀
        let cmdLine = line.replace(/^fastboot\s+%\*\s*/, '');

        // 截取到 || 之前的部分
        const pipeIndex = cmdLine.indexOf('||');
        if (pipeIndex !== -1) {
            cmdLine = cmdLine.substring(0, pipeIndex);
        }
        command = cmdLine.trim();

        // 移除 %~dp0images 等路径参数（仅保留 flash <partition>）
        if (command.includes('%~dp0images')) {
            const parts = command.split(/\s+/);
            command = parts.slice(0, 2).join(' '); // 只保留 "flash partition"
        }

        // 验证命令是否有效
        if (!command || command === '%*' || command.startsWith('%~')) {
            log(`[调试] 无效命令，跳过: ${command}`, 'warning');
            continue;
        }
        commandCount++;
        currentCommand++;

        // 调试日志: 显示解析出的命令
        log(`[调试] 原始行: ${lines[i]}`, 'info');
        log(`[调试] 解析命令: ${command}`, 'info');
        console.log(`[命令转换] ${lines[i]} → fastboot ${command}`);

        try {
            // 更新进度
            const progress = Math.floor((currentCommand / totalCommands) * 100);
            updateProgressBar(progress);
            updateProgressStats(totalCommands, successCount, failCount);

            // 提取命令类型和参数
            const parts = command.split(/\s+/);
            const cmdType = parts[0].toLowerCase();

            if (cmdType === 'erase') {
                const partition = parts[1];
                if (!partition) {
                    log(`  错误: 命令缺少分区参数: ${command}`, 'error');
                    failCount++;
                    addProgressLog(`  ✗ 错误: 缺少分区参数`, 'error');
                    updateProgressStats(totalCommands, successCount, failCount);
                    continue;
                }
                updateProgressStatus(`擦除分区: ${partition}`);
                addProgressLog(`[${currentCommand}/${totalCommands}] fastboot erase ${partition}`, 'info');
                addProgressLog(`  └─ 分区名称: ${partition}`, 'info');
                addProgressLog(`  └─ 正在执行擦除操作...`, 'info');

                await fb.runCommand(`erase:${partition}`);

                log(`[${commandCount}] 执行: fastboot erase ${partition}`, 'info');
                log(`  成功: ${partition}`, 'success');
                successCount++;
                addProgressLog(`  └─ ✓ 分区擦除成功`, 'success');
                updateProgressStats(totalCommands, successCount, failCount);

            } else if (cmdType === 'flash') {
                const partition = parts[1];
                if (!partition) {
                    log(`  错误: 命令缺少分区参数: ${command}`, 'error');
                    failCount++;
                    addProgressLog(`  ✗ 错误: 缺少分区参数`, 'error');
                    updateProgressStats(totalCommands, successCount, failCount);
                    continue;
                }

                // 提取文件路径从原始行
                const pathMatch = lines[i].match(/%~dp0images\\(.+?)\s*\|\|/);
                if (!pathMatch) {
                    log(`  错误: 无法提取文件路径: ${lines[i]}`, 'error');
                    failCount++;
                    errors.push(`${partition}: 无法提取文件路径`);
                    addProgressLog(`  ✗ 错误: 无法提取文件路径`, 'error');
                    updateProgressStats(totalCommands, successCount, failCount);
                    continue;
                }

                const fileName = pathMatch[1];
                const displayPath = `${imagePackageName}/images/${fileName}`;
                console.log(`[命令转换] flash xbl_ab %~dp0images\\xbl.img || ... → fastboot flash xbl_ab ${displayPath}`);
                updateProgressStatus(`刷入: ${partition} (${fileName})`);
                addProgressLog(`[${currentCommand}/${totalCommands}] fastboot flash ${partition}`, 'info');
                addProgressLog(`  └─ 文件名: ${fileName}`, 'info');

                // 读取镜像文件
                const fileData = await readImageFile(fileName);
                if (!fileData) {
                    log(`  错误: 无法读取文件 ${fileName}`, 'error');
                    failCount++;
                    errors.push(`${partition}: 无法读取文件 ${fileName}`);
                    addProgressLog(`  ✗ 错误: 无法读取文件 ${fileName}`, 'error');
                    updateProgressStats(totalCommands, successCount, failCount);
                    continue;
                }

                // 添加文件大小信息
                const fileSize = formatFileSize(fileData.size);
                addProgressLog(`  └─ 文件大小: ${fileSize}`, 'info');
                addProgressLog(`  └─ 目标分区: ${partition}`, 'info');
                addProgressLog(`  └─ 正在刷入...`, 'info');

                // 使用 android-fastboot 库的 flashBlob 方法
                log(`使用 android-fastboot 库刷入 ${partition}...`, 'info');
                // File 对象本身就是 Blob，可以直接使用
                await fb.flashBlob(partition, fileData, (progress) => {
                    const percent = Math.floor(progress * 100);
                    if (percent % 20 === 0 || percent === 100) {
                        addProgressLog(`  └─ 刷入进度: ${percent}%`, 'info');
                    }
                });
                console.log(`[Flash] ${partition} 刷入完成`);

                log(`[${commandCount}] 执行: fastboot flash ${partition} ${fileName}`, 'info');
                log(`  成功: ${partition}`, 'success');
                successCount++;
                addProgressLog(`  └─ ✓ 刷入成功 (${fileSize})`, 'success');
                updateProgressStats(totalCommands, successCount, failCount);

            } else if (cmdType === '-w' || line.includes('-w')) {
                updateProgressStatus('格式化用户数据...');
                addProgressLog(`[${currentCommand}/${totalCommands}] fastboot -w`, 'info');
                addProgressLog(`  └─ 操作类型: 格式化`, 'info');
                addProgressLog(`  └─ 目标分区: userdata`, 'info');
                addProgressLog(`  └─ 正在执行格式化操作...`, 'info');

                // android-fastboot 使用 erase:userdata
                await fb.runCommand('erase:userdata');

                log(`[${commandCount}] 执行: fastboot -w`, 'info');
                log(`  成功: format userdata`, 'success');
                successCount++;
                addProgressLog(`  └─ ✓ 格式化完成`, 'success');
                updateProgressStats(totalCommands, successCount, failCount);

            } else if (cmdType === 'reboot') {
                updateProgressStatus('正在重启设备...');
                addProgressLog(`[${currentCommand}/${totalCommands}] fastboot reboot`, 'info');
                addProgressLog(`  └─ 操作类型: 重启设备`, 'info');
                addProgressLog(`  └─ 正在发送重启命令...`, 'info');

                await fb.reboot();

                log(`[${commandCount}] 执行: fastboot reboot`, 'info');
                log(`  成功: reboot`, 'success');
                successCount++;
                addProgressLog(`  └─ ✓ 设备正在重启`, 'success');
                updateProgressStats(totalCommands, successCount, failCount);

            } else {
                log(`  跳过未知命令: ${cmdType}`, 'warning');
                addProgressLog(`  ⚠ 跳过未知命令: ${cmdType}`, 'warning');
            }

        } catch (error) {
            log(`  失败: ${error.message}`, 'error');
            failCount++;
            errors.push(`命令 ${commandCount}: ${error.message}`);
            addProgressLog(`  └─ ✗ 失败: ${error.message}`, 'error');
            if (error.stack) {
                addProgressLog(`  └─ 错误详情: ${error.message}`, 'error');
            }
            updateProgressStats(totalCommands, successCount, failCount);
        }
    }

    // 完成进度
    updateProgressBar(100);
    updateProgressStatus('刷入完成');

    log('========================================', 'info');
    log(`命令执行完成`, 'info');
    log(`总计: ${commandCount} 个命令`, 'info');
    log(`成功: ${successCount} 个`, 'success');
    log(`失败: ${failCount} 个`, failCount > 0 ? 'error' : 'info');

    if (errors.length > 0) {
        log('失败详情:', 'error');
        errors.forEach(err => log(`  - ${err}`, 'error'));
    }

    addProgressLog('═════════════════════════════════', 'info');
    addProgressLog('所有命令执行完毕', 'info');
    addProgressLog(`总计: ${commandCount} 个命令`, 'info');
    addProgressLog(`✓ 成功: ${successCount} 个`, 'success');
    if (failCount > 0) {
        addProgressLog(`✗ 失败: ${failCount} 个`, 'error');
    }
    addProgressLog('═════════════════════════════════', 'info');

    // 显示完成状态
    showFlashProgressComplete(successCount, failCount);

    // 重置刷入标志
    isFlashing = false;
}

// 读取镜像文件
async function readImageFile(fileName) {
    try {
        if (!imagesFolderHandle) {
            return null;
        }

        const imagesDirHandle = await imagesFolderHandle.getDirectoryHandle('images');
        const fileHandle = await imagesDirHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        // 返回 File 对象而不是 ArrayBuffer，避免将大文件全部读入内存
        return file;
    } catch (error) {
        console.error(`读取镜像文件失败: ${error.message}`);
        return null;
    }
}

// 显示刷入进度容器
function showFlashProgressContainer() {
    const flashContainer = document.getElementById('flash-container');
    const fastbootCheckContainer = document.getElementById('fastboot-check-container');
    const progressContainer = document.getElementById('flash-progress-container');
    const appTitle = document.getElementById('app-title');
    const toggle = document.getElementById('details-toggle');
    const content = document.getElementById('flash-progress-details');

    // 确定当前显示的容器
    const currentContainer = fastbootCheckContainer.style.display !== 'none' ? fastbootCheckContainer : flashContainer;

    // 直接隐藏当前容器，显示进度容器
    if (currentContainer) {
        currentContainer.style.display = 'none';
    }
    progressContainer.style.display = 'block';

    // 更新标题
    if (appTitle) appTitle.textContent = '刷入进度';
}

// 更新进度条百分比
function updateProgressBar(percent) {
    const percentEl = document.getElementById('flash-progress-percent');
    const fillEl = document.getElementById('flash-progress-fill');

    if (percentEl) percentEl.textContent = `${percent}%`;
    if (fillEl) fillEl.style.width = `${percent}%`;
}

// 更新进度状态
function updateProgressStatus(status) {
    const statusEl = document.getElementById('flash-progress-status');
    const taskEl = document.getElementById('flash-current-task');

    if (statusEl) statusEl.textContent = status;
    if (taskEl) taskEl.textContent = status;
}

// 更新进度统计
function updateProgressStats(total, success, failed) {
    const totalEl = document.getElementById('details-total');
    const successEl = document.getElementById('details-success');
    const failedEl = document.getElementById('details-failed');

    if (totalEl) totalEl.textContent = total;
    if (successEl) successEl.textContent = success;
    if (failedEl) failedEl.textContent = failed;
}

// 日志节流队列
let logQueue = [];
let isProcessingLog = false;
let shouldAutoScroll = true; // 是否自动滚动到底部

// 添加进度日志（带节流，每秒最多更新一次）
function addProgressLog(message, type = 'info') {
    const logContainer = document.getElementById('flash-progress-log');
    if (!logContainer) return;

    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
        <span class="log-time">[${timestamp}]</span>
        <span class="log-command">${message}</span>
    `;

    // 添加到队列
    logQueue.push(entry);

    // 如果正在处理，直接返回
    if (isProcessingLog) return;

    processLogQueue();
}

// 处理日志队列（每秒最多更新一次）
function processLogQueue() {
    if (logQueue.length === 0) {
        isProcessingLog = false;
        return;
    }

    isProcessingLog = true;
    const logContainer = document.getElementById('flash-progress-log');

    // 检查是否接近底部（用户是否在往上查看）
    const isNearBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 50;

    // 批量添加所有待处理的日志
    logQueue.forEach(entry => {
        logContainer.appendChild(entry);
    });

    // 清空队列
    logQueue = [];

    // 只有当用户正在查看底部时才自动滚动
    if (isNearBottom) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // 1秒后继续处理
    setTimeout(() => {
        isProcessingLog = false;
        processLogQueue();
    }, 1000);
}

// 显示刷入完成状态
function showFlashProgressComplete(successCount, failCount) {
    const progressCard = document.querySelector('.flash-progress-card');
    const completeSection = document.getElementById('flash-progress-complete');
    const completeTitle = document.getElementById('complete-title');
    const completeSummary = document.getElementById('complete-summary');
    const successCheckmark = document.querySelector('.success-checkmark');
    const infoIcons = document.querySelectorAll('.info-icon');

    // 隐藏进度卡片,显示完成卡片
    if (progressCard) {
        progressCard.style.display = 'none';
    }

    // 设置标题和状态
    if (failCount > 0) {
        completeTitle.textContent = '刷入失败';
        completeTitle.style.background = 'linear-gradient(135deg, #ff6b9d 0%, #ff9f43 100%)';
        completeTitle.style.webkitBackgroundClip = 'text';
        completeTitle.style.webkitTextFillColor = 'transparent';
        completeTitle.style.backgroundClip = 'text';

        // 失败时改变图标颜色
        if (successCheckmark) {
            successCheckmark.style.background = 'linear-gradient(135deg, #ff6b9d 0%, #ff9f43 100%)';
        }

        // 失败时改变信息图标样式
        infoIcons.forEach(icon => {
            icon.className = 'info-icon error';
        });
    } else {
        completeTitle.textContent = '刷入成功';
        completeTitle.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        completeTitle.style.webkitBackgroundClip = 'text';
        completeTitle.style.webkitTextFillColor = 'transparent';
        completeTitle.style.backgroundClip = 'text';

        // 成功时恢复图标颜色
        if (successCheckmark) {
            successCheckmark.style.background = 'linear-gradient(135deg, #4ec9b0 0%, #4fc1ff 100%)';
        }

        // 成功时恢复信息图标样式
        infoIcons.forEach(icon => {
            icon.className = 'info-icon success';
        });
    }

    const modeInput = document.querySelector('input[name="flash-mode"]:checked');
    let modeText = '';
    if (modeInput) {
        modeText = modeInput.value === 'format' ? '格式化刷入' : '保留数据刷入';
    }
    const deviceName = packageInfo && packageInfo.device && packageInfo.device !== '未知'
        ? packageInfo.device
        : '未知机型';
    const baseSummary = `机型 ${deviceName}${modeText ? ` · ${modeText}` : ''}`;
    const commandSummary = `成功 ${successCount} 个命令${failCount > 0 ? `，失败 ${failCount} 个` : ''}`;
    completeSummary.textContent = `${baseSummary} · ${commandSummary}`;
    completeSection.style.display = 'block';
}

// 展开/收起详细信息
function toggleDetails() {
    const toggle = document.getElementById('details-toggle');
    const content = document.getElementById('flash-progress-details');

    if (toggle && content) {
        const isExpanded = toggle.classList.contains('expanded');
        toggle.classList.toggle('expanded', !isExpanded);
        const newDisplay = !isExpanded ? 'block' : 'none';
        content.style.display = newDisplay;

        // 更新 SVG 图标旋转
        const svg = toggle.querySelector('svg');
        if (svg) {
            svg.style.transform = !isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        }
    }
}

// 刷入完成后返回首页
function returnToFlashAfterProgress() {
    const progressContainer = document.getElementById('flash-progress-container');
    const mainGrid = document.getElementById('main-grid');
    const progressCard = document.querySelector('.flash-progress-card');
    const completeCard = document.getElementById('flash-progress-complete');
    const appTitle = document.getElementById('app-title');

    // 重置进度卡片和完成卡片的显示状态
    if (progressCard) {
        progressCard.style.display = 'block';
    }
    if (completeCard) {
        completeCard.style.display = 'none';
    }

    // 隐藏进度容器,显示主界面
    progressContainer.style.display = 'none';
    mainGrid.style.display = 'grid';

    // 重置标题
    appTitle.textContent = 'WEB 小米线刷工具';

    // 重置按钮状态
    const flashBtn = document.getElementById('flash-start-btn');
    flashBtn.disabled = false;
    flashBtn.querySelector('span').textContent = '开始刷入';

    // 重置进度条
    updateProgressBar(0);
    document.getElementById('flash-progress-status').textContent = '准备中...';
    document.getElementById('flash-current-task').textContent = '等待开始...';

    // 重置统计
    document.getElementById('details-total').textContent = '0';
    document.getElementById('details-success').textContent = '0';
    document.getElementById('details-failed').textContent = '0';

    // 清空日志
    const logContent = document.getElementById('flash-progress-log');
    if (logContent) {
        logContent.innerHTML = '';
    }

    // 重置刷入标志
    isFlashing = false;
}
