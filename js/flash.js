// 全局变量
let fastbootTransport = null;
let fastbootDevice = null;
let adbTransport = null;
let adbDevice = null;
let selectedFolder = null;
let packageInfo = null;
let imageFiles = [];
let currentMode = null; // 'adb' 或 'fastboot'
let lastConnectedMode = null; // 记录主页最后连接的模式

// 日志功能
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
function showPackageInfo(info) {
    const flashInfo = document.getElementById('flash-info');
    
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
    
    flashInfo.innerHTML = html;
    log('刷机包信息:', 'info');
    log(`  机型: ${info.device}`, 'info');
    log(`  系统版本: ${info.build_number}`, 'info');
    log(`  更新日期: ${info.userdata_version}`, 'info');
}

// 显示镜像文件列表
function showImageList(files) {
    const imageList = document.getElementById('image-list');
    
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
        
        // 使用 File System Access API
        const dirHandle = await window.showDirectoryPicker({
            mode: 'read',
            startIn: 'documents'
        });
        
        selectedFolder = dirHandle;
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
            // 直接在根目录查找镜像文件
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
            showPackageInfo(packageInfo);
        } else {
            log('未找到 misc.txt 文件', 'warning');
            packageInfo = {
                device: '未知',
                build_number: '未知',
                userdata_version: '未知'
            };
            showPackageInfo(packageInfo);
        }
        
        // 更新刷入按钮状态
        if (imageFiles.length > 0 && (adbDevice || fastbootDevice)) {
            document.getElementById('flash-btn').disabled = false;
        }
        
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
            // 常见的镜像文件扩展名
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
        showImageList(imageFiles);
    } else {
        document.getElementById('image-list').innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>未找到镜像文件</p>
            </div>
        `;
        log('未找到镜像文件', 'warning');
    }
}

// 检查是否有已连接的设备（通过URL参数）
function checkConnectedDevice() {
    // 从URL参数获取连接模式
    const urlParams = new URLSearchParams(window.location.search);
    const connectedMode = urlParams.get('mode');
    
    if (connectedMode && (connectedMode === 'adb' || connectedMode === 'fastboot')) {
        log(`检测到来自主页的连接模式: ${connectedMode.toUpperCase()}`, 'info');
        lastConnectedMode = connectedMode;
        currentMode = connectedMode;
        updateDeviceStatus(true, true); // true 表示是从主页来的状态（需要重新连接）
        return connectedMode;
    }
    
    log('未检测到主页连接状态', 'info');
    currentMode = null;
    return null;
}

// 连接设备
async function connectDevice() {
    try {
        // 先检查是否有已连接的设备
        const existingMode = checkConnectedDevice();
        
        if (existingMode === 'adb') {
            log('使用已连接的 ADB 设备', 'info');
            // 需要重新连接 ADB 设备
            await reconnectAdb();
            return;
        }
        
        log('========================================', 'info');
        log('正在连接设备...', 'info');
        
        const device = await navigator.usb.requestDevice({
            filters: [
                { classCode: 255, subclassCode: 66, protocolCode: 1 }, // ADB
                { classCode: 255, subclassCode: 66, protocolCode: 3 }  // Fastboot
            ]
        });
        
        // 检测设备类型
        const deviceType = detectDeviceType(device);
        
        log('正在打开设备...', 'info');
        await device.open();
        
        const transport = new Adb.WebUSB.Transport(device);
        
        if (deviceType === 'adb') {
            log('正在建立 ADB 连接...', 'info');
            adbDevice = await transport.connectAdb("webadb::", function() {
                log('请在设备上确认授权', 'warning');
            });
            
            adbTransport = transport;
            currentMode = 'adb';
            log('========================================', 'success');
            log('ADB 连接成功！', 'success');
            
        } else {
            log('正在建立 Fastboot 连接...', 'info');
            fastbootDevice = await transport.connectFastboot();
            
            fastbootTransport = transport;
            currentMode = 'fastboot';
            log('========================================', 'success');
            log('Fastboot 连接成功！', 'success');
        }
        
        updateDeviceStatus(true);
        
        // 更新刷入按钮状态
        if (imageFiles.length > 0) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`连接失败: ${error.message}`, 'error');
    }
}

// 重新连接 ADB 设备
async function reconnectAdb() {
    try {
        const device = await navigator.usb.requestDevice({
            filters: [
                { classCode: 255, subclassCode: 66, protocolCode: 1 }
            ]
        });
        
        log('正在打开设备...', 'info');
        await device.open();
        
        const transport = new Adb.WebUSB.Transport(device);
        adbDevice = await transport.connectAdb("webadb::", function() {
            log('请在设备上确认授权', 'warning');
        });
        
        adbTransport = transport;
        currentMode = 'adb';
        log('ADB 连接成功！', 'success');
        
        updateDeviceStatus(true);
        
        if (imageFiles.length > 0) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`ADB 重连失败: ${error.message}`, 'error');
    }
}

// 检测设备类型
function detectDeviceType(device) {
    for (let i in device.configurations) {
        let conf = device.configurations[i];
        for (let j in conf.interfaces) {
            let intf = conf.interfaces[j];
            for (let k in intf.alternates) {
                let alt = intf.alternates[k];
                if (alt.interfaceClass === 255 && 
                    alt.interfaceSubclass === 66 && 
                    alt.interfaceProtocol === 1) {
                    return 'adb';
                }
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

// 更新设备状态显示
function updateDeviceStatus(connected, fromMain = false) {
    const deviceStatus = document.getElementById('device-status');
    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    
    if (connected) {
        statusBadge.classList.add('connected');
        statusText.textContent = currentMode === 'adb' ? 'ADB' : 'Fastboot';
        
        const statusTextContent = fromMain 
            ? `${currentMode === 'adb' ? 'ADB' : 'Fastboot'} 已连接 (点击重新连接)`
            : `${currentMode === 'adb' ? 'ADB' : 'Fastboot'} 已连接`;
        
        deviceStatus.innerHTML = `
            <div class="status-connected">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38ef7d" stroke-width="2">
                    <rect x="5" y="2" width="14" height="20" rx="2"/>
                    <line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <span>${statusTextContent}</span>
            </div>
        `;
    } else {
        statusBadge.classList.remove('connected');
        statusText.textContent = '未连接';
        
        deviceStatus.innerHTML = `
            <div class="status-placeholder">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1">
                    <rect x="5" y="2" width="14" height="20" rx="2"/>
                </svg>
                <p>点击连接设备</p>
            </div>
        `;
    }
}

// 开始刷入
async function startFlash() {
    if (!adbDevice && !fastbootDevice || imageFiles.length === 0) {
        log('设备未连接或未选择镜像文件', 'error');
        return;
    }
    
    try {
        log('========================================', 'info');
        log('开始刷入线刷包...', 'warning');
        log(`当前模式: ${currentMode === 'adb' ? 'ADB' : 'Fastboot'}`, 'info');
        log(`共 ${imageFiles.length} 个镜像文件`, 'info');
        
        const flashBtn = document.getElementById('flash-btn');
        flashBtn.disabled = true;
        flashBtn.querySelector('span').textContent = '刷入中...';
        
        // 如果是 ADB 模式，先切换到 Fastboot
        if (currentMode === 'adb') {
            log('ADB 模式需要先切换到 Fastboot', 'warning');
            log('正在重启到 Fastboot...', 'info');
            
            await adbDevice.rebootToFastboot();
            
            log('请等待设备重启后重新连接 Fastboot', 'warning');
            log('========================================', 'success');
            
            // 重置设备状态
            adbDevice = null;
            adbTransport = null;
            currentMode = null;
            updateDeviceStatus(false);
            flashBtn.disabled = false;
            flashBtn.querySelector('span').textContent = '开始刷入';
            
            return;
        }
        
        // Fastboot 模式刷入
        for (let i = 0; i < imageFiles.length; i++) {
            const imgFile = imageFiles[i];
            log(`[${i + 1}/${imageFiles.length}] 正在刷入: ${imgFile.name}`, 'info');
            
            const file = await imgFile.handle.getFile();
            const buffer = await file.arrayBuffer();
            
            // 使用 fastboot flash 命令刷入
            const partitionName = imgFile.name.replace(/\.(img|bin|mbn)$/i, '');
            await fastbootDevice.flash(partitionName, buffer);
            
            log(`[完成] ${imgFile.name}`, 'success');
        }
        
        log('========================================', 'success');
        log('刷入完成！', 'success');
        log('========================================', 'success');
        
        flashBtn.querySelector('span').textContent = '刷入完成';
        
    } catch (error) {
        log(`刷入失败: ${error.message}`, 'error');
        
        const flashBtn = document.getElementById('flash-btn');
        flashBtn.disabled = false;
        flashBtn.querySelector('span').textContent = '开始刷入';
    }
}

// 返回主页
function goBack() {
    window.location.href = 'index.html';
}

// 事件监听
document.addEventListener('DOMContentLoaded', function() {
    // 检查浏览器支持
    if (!navigator.usb) {
        log('您的浏览器不支持 WebUSB，请使用 Chrome 或 Edge', 'error');
        document.getElementById('select-folder-btn').disabled = true;
        return;
    }
    
    // 检查 File System Access API 支持
    if (!window.showDirectoryPicker) {
        log('您的浏览器不支持文件夹选择功能', 'error');
        document.getElementById('select-folder-btn').disabled = true;
    }
    
    // 检查是否有之前连接的设备类型
    const existingMode = checkConnectedDevice();
    if (!existingMode) {
        // 如果没有有效连接，确保状态显示为未连接
        updateDeviceStatus(false);
    }
    
    // 选择文件夹按钮
    document.getElementById('select-folder-btn').addEventListener('click', selectFolder);
    
    // 刷入按钮
    document.getElementById('flash-btn').addEventListener('click', startFlash);
    
    // 返回按钮
    document.getElementById('back-btn').addEventListener('click', goBack);
    
    // 设备状态区域点击连接
    document.getElementById('device-status').addEventListener('click', connectDevice);
    
    // 初始化日志
    log('========================================', 'info');
    log('线刷包刷入工具 v1.0', 'success');
    log('========================================', 'info');
    log('工具已准备就绪', 'success');
    if (existingMode) {
        log(`检测到主页已连接 ${existingMode.toUpperCase()} 设备，点击重新连接`, 'info');
    }
    log('请选择线刷包文件夹并连接设备', 'info');
    log('========================================', 'info');
});
