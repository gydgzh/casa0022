#!/bin/bash
# Cloudflare Tunnel 一键启动脚本
# 为 iPad 提供合法 HTTPS 证书，绕过自签名限制

set -e

PROJECT_DIR="/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
MOSQUITTO_CONF="$PROJECT_DIR/mosquitto/mosquitto.conf"

echo "=== Holographic Virtual Librarian - Cloudflare Tunnel Launcher ==="
echo ""

# 1. 清理旧进程
echo "[1/5] 清理旧进程..."
pkill -f vite 2>/dev/null || true
pkill -f cloudflared 2>/dev/null || true
pkill -f mosquitto 2>/dev/null || true
sleep 2

# 2. 启动 Mosquitto
echo "[2/5] 启动 Mosquitto..."
if [ -f "$MOSQUITTO_CONF" ]; then
    mosquitto -c "$MOSQUITTO_CONF" > /tmp/mosq.log 2>&1 &
else
    # 如果没有配置文件，使用默认配置
    mosquitto -p 1883 > /tmp/mosq.log 2>&1 &
fi
sleep 2

# 3. 启动 Vite HTTP 模式
echo "[3/5] 启动 Vite (HTTP 模式)..."
cd "$PROJECT_DIR"
HTTP_ONLY=1 npx vite --host 0.0.0.0 > /tmp/vite.log 2>&1 &
sleep 3

# 4. 启动 Cloudflare Tunnel
echo "[4/5] 启动 Cloudflare Tunnel..."
# 使用临时隧道，无需注册账号
cloudflared tunnel --url http://localhost:5173 > /tmp/cf.out 2>&1 &
CF_PID=$!

# 5. 等待并提取 URL
echo "[5/5] 等待隧道建立..."
sleep 8

# 从日志中提取 trycloudflare.com URL
TUNNEL_URL=$(grep -o 'https://[^ ]*\.trycloudflare\.com' /tmp/cf.out | head -1)

if [ -z "$TUNNEL_URL" ]; then
    echo "⚠️  隧道 URL 未找到，等待更长时间..."
    sleep 5
    TUNNEL_URL=$(grep -o 'https://[^ ]*\.trycloudflare\.com' /tmp/cf.out | head -1)
fi

echo ""
echo "=== ✅ 服务已启动 ==="
echo ""

if [ -n "$TUNNEL_URL" ]; then
    echo "🌐 Cloudflare Tunnel URL: $TUNNEL_URL"
    echo ""
    echo "📱 iPad 测试链接（复制到 Safari）："
    echo ""
    echo "  1. Mirror 模式（仅摄像头）:"
    echo "     ${TUNNEL_URL}/?mode=capture&features=mirror&sensors=mock&avatar=/3D_/ryu2.vrm"
    echo ""
    echo "  2. Listen 模式（仅麦克风）:"
    echo "     ${TUNNEL_URL}/?mode=capture&features=listen&sensors=mock&avatar=/3D_/ryu2.vrm"
    echo ""
    echo "  3. Both 模式（默认）:"
    echo "     ${TUNNEL_URL}/?mode=capture&features=both&sensors=mock&avatar=/3D_/ryu2.vrm"
    echo ""
    echo "  4. Both + 自定义 VRM:"
    echo "     ${TUNNEL_URL}/?mode=capture&features=both&sensors=mock&avatar=/3D_/ryu2.vrm"
    echo ""
    
    # 生成二维码
    python3 -c "
import qrcode
import sys
url = '${TUNNEL_URL}/?mode=capture&features=both&sensors=mock&avatar=/3D_/ryu2.vrm'
qr = qrcode.QRCode(version=3, box_size=10, border=4, error_correction=qrcode.constants.ERROR_CORRECT_M)
qr.add_data(url)
qr.make(fit=True)
img = qr.make_image(fill_color='black', back_color='white')
img.save('/Users/yimisheng/Desktop/DLLLL1_iPad_qrcode.png')
print('📱 二维码已保存到: /Users/yimisheng/Desktop/DLLLL1_iPad_qrcode.png')
" 2>/dev/null || echo "⚠️  二维码生成失败，请手动复制链接"
    
    open /Users/yimisheng/Desktop/DLLLL1_iPad_qrcode.png 2>/dev/null || true
else
    echo "⚠️  警告: 未找到 tunnel URL"
    echo "   请手动检查: tail -f /tmp/cf.out"
fi

echo ""
echo "=== 📊 监控日志 ==="
echo "  Cloudflare: tail -f /tmp/cf.out"
echo "  Vite:       tail -f /tmp/vite.log"
echo "  Mosquitto:  tail -f /tmp/mosq.log"
echo ""
echo "=== 🛑 停止服务 ==="
echo "  pkill -f vite; pkill -f cloudflared; pkill -f mosquitto"
echo ""

# 保持脚本运行
wait $CF_PID
