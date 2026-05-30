"""
签名 URL 功能测试脚本

测试完整的签名 URL 生成和验证流程
"""

import sys
sys.path.insert(0, '.')

from services.signed_url_service import generate_signed_image_url, verify_signed_url
from urllib.parse import urlparse, parse_qs

def test_signed_url():
    print("=" * 60)
    print("签名 URL 功能测试")
    print("=" * 60)
    print()

    # 测试数据
    image_path = '2026/05/27/test-image.png'
    base_url = 'http://localhost:3100'

    # 1. 生成签名 URL
    print("1. 生成签名 URL")
    print("-" * 60)
    signed_url = generate_signed_image_url(image_path, base_url, expires_in=3600)
    print(f"图片路径: {image_path}")
    print(f"基础 URL: {base_url}")
    print(f"有效期: 3600 秒 (1 小时)")
    print(f"签名 URL: {signed_url}")
    print()

    # 2. 解析 URL 参数
    print("2. 解析 URL 参数")
    print("-" * 60)
    parsed = urlparse(signed_url)
    params = parse_qs(parsed.query)
    expires = int(params['expires'][0])
    signature = params['signature'][0]
    print(f"路径: {parsed.path}")
    print(f"过期时间戳: {expires}")
    print(f"签名: {signature}")
    print()

    # 3. 验证正确的签名
    print("3. 验证正确的签名")
    print("-" * 60)
    is_valid = verify_signed_url(image_path, expires, signature)
    print(f"验证结果: {'通过' if is_valid else '失败'}")
    assert is_valid, "正确的签名应该验证通过"
    print()

    # 4. 测试错误的签名
    print("4. 测试错误的签名")
    print("-" * 60)
    is_valid_wrong = verify_signed_url(image_path, expires, 'wrong_signature')
    print(f"验证结果: {'通过' if is_valid_wrong else '失败'}")
    assert not is_valid_wrong, "错误的签名应该验证失败"
    print()

    # 5. 测试过期的签名
    print("5. 测试过期的签名")
    print("-" * 60)
    is_valid_expired = verify_signed_url(image_path, 1000000000, signature)
    print(f"验证结果: {'通过' if is_valid_expired else '失败'}")
    assert not is_valid_expired, "过期的签名应该验证失败"
    print()

    # 6. 测试不同图片路径
    print("6. 测试不同图片路径")
    print("-" * 60)
    wrong_path = '2026/05/27/different-image.png'
    is_valid_wrong_path = verify_signed_url(wrong_path, expires, signature)
    print(f"原始路径: {image_path}")
    print(f"错误路径: {wrong_path}")
    print(f"验证结果: {'通过' if is_valid_wrong_path else '失败'}")
    assert not is_valid_wrong_path, "不同路径的签名应该验证失败"
    print()

    print("=" * 60)
    print("所有测试通过!")
    print("=" * 60)

if __name__ == '__main__':
    test_signed_url()
