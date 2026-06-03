"""
签名 URL 服务

为图片生成带时效性的签名 URL，允许在不需要认证的情况下临时访问图片。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from urllib.parse import urlencode


def _get_signing_secret() -> str:
    """获取签名密钥"""
    # 优先使用环境变量
    secret = os.environ.get("IMAGE_SIGNING_SECRET")
    if secret:
        return secret

    # 使用默认密钥（生产环境应该配置环境变量）
    return "default-image-signing-secret-change-in-production"


def generate_signed_image_url(image_path: str, base_url: str, expires_in: int = 3600) -> str:
    """
    生成带签名的图片 URL

    Args:
        image_path: 图片相对路径（如 "2026/05/27/xxx.png"）
        base_url: API 基础 URL（如 "http://localhost:3100"）
        expires_in: 有效期（秒），默认 1 小时

    Returns:
        带签名的完整 URL
    """
    # 计算过期时间戳
    expires = int(time.time()) + expires_in

    # 生成签名
    secret = _get_signing_secret()
    message = f"{image_path}:{expires}"
    signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()[:16]  # 只取前16个字符，减少 URL 长度

    # 构建 URL
    params = urlencode({
        "expires": expires,
        "signature": signature,
    })

    # 移除开头的斜杠（如果有）
    clean_path = image_path.lstrip("/")

    return f"{base_url}/public-images/{clean_path}?{params}"


def verify_signed_url(image_path: str, expires: int, signature: str) -> bool:
    """
    验证签名 URL 是否有效

    Args:
        image_path: 图片相对路径
        expires: 过期时间戳
        signature: 签名

    Returns:
        是否有效
    """
    # 检查是否过期
    if int(time.time()) > expires:
        return False

    # 验证签名
    secret = _get_signing_secret()
    message = f"{image_path}:{expires}"
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()[:16]

    return hmac.compare_digest(signature, expected_signature)
