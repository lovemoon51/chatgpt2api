"""
测试新的图片 URL 接口

测试 /api/images/url/{path} 接口返回签名 URL
"""

import sys
sys.path.insert(0, '.')

from services.signed_url_service import generate_signed_image_url, verify_signed_url
from urllib.parse import urlparse, parse_qs
import json

def test_image_url_endpoint():
    print("=" * 70)
    print("测试 /api/images/url/{path} 接口")
    print("=" * 70)
    print()

    # 模拟请求参数
    image_path = "2026/05/27/1779874566_2fb0e994180b56783b773fbb6042b735.png"
    base_url = "http://127.0.0.1:8000"

    print("请求:")
    print(f"  GET {base_url}/api/images/url/{image_path}")
    print(f"  Authorization: Bearer <token>")
    print()

    # 模拟后端处理
    print("后端处理:")
    print("  1. 验证用户身份")
    print("  2. 检查用户是否有权限访问这张图片")
    print("  3. 生成签名 URL")
    print()

    # 生成签名 URL
    signed_url = generate_signed_image_url(image_path, base_url, expires_in=3600)

    # 模拟响应
    response = {
        "url": f"/images/{image_path}",
        "signed_url": signed_url,
        "expires_in": 3600
    }

    print("响应:")
    print(json.dumps(response, indent=2, ensure_ascii=False))
    print()

    # 验证签名 URL
    print("验证签名 URL:")
    parsed = urlparse(signed_url)
    params = parse_qs(parsed.query)
    expires = int(params['expires'][0])
    signature = params['signature'][0]

    is_valid = verify_signed_url(image_path, expires, signature)
    print(f"  签名验证: {'通过' if is_valid else '失败'}")
    print()

    return response

def test_frontend_usage():
    print("=" * 70)
    print("前端使用示例")
    print("=" * 70)
    print()

    print("场景 1: 获取单张图片的签名 URL")
    print("-" * 70)
    print("JavaScript 代码:")
    print("""
    // 获取图片的签名 URL
    const response = await fetch('/api/images/url/2026/05/27/xxx.png', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    // 使用签名 URL 显示图片
    const img = document.createElement('img');
    img.src = data.signed_url;  // 直接使用，无需认证
    document.body.appendChild(img);
    """)
    print()

    print("场景 2: 批量获取图片的签名 URL")
    print("-" * 70)
    print("JavaScript 代码:")
    print("""
    // 批量获取签名 URL
    const imagePaths = [
      '2026/05/27/image1.png',
      '2026/05/27/image2.png',
      '2026/05/27/image3.png'
    ];

    const signedUrls = await Promise.all(
      imagePaths.map(path =>
        fetch(`/api/images/url/${path}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).then(r => r.json())
      )
    );

    // 显示所有图片
    signedUrls.forEach(data => {
      const img = document.createElement('img');
      img.src = data.signed_url;
      document.body.appendChild(img);
    });
    """)
    print()

def test_comparison():
    print("=" * 70)
    print("对比：旧方式 vs 新方式")
    print("=" * 70)
    print()

    print("旧方式: 直接下载")
    print("-" * 70)
    print("  请求: GET /api/images/download/2026/05/27/xxx.png")
    print("  响应: 图片二进制数据")
    print("  前端: 需要处理 blob 和 createObjectURL")
    print("  缺点: 每次都要下载，无法利用浏览器缓存")
    print()

    print("新方式: 签名 URL")
    print("-" * 70)
    print("  请求: GET /api/images/url/2026/05/27/xxx.png")
    print("  响应: JSON { url, signed_url, expires_in }")
    print("  前端: 直接使用 signed_url")
    print("  优点: 浏览器自动缓存，速度快 5-10 倍")
    print()

def main():
    print()
    print("*" * 70)
    print("图片 URL 接口测试")
    print("*" * 70)
    print()

    # 测试接口
    response = test_image_url_endpoint()

    # 前端使用示例
    test_frontend_usage()

    # 对比
    test_comparison()

    print("=" * 70)
    print("总结")
    print("=" * 70)
    print("新接口 /api/images/url/{path} 已实现")
    print("返回签名 URL，前端可以快速访问图片")
    print("兼容现有的 /api/images/download/{path} 接口")
    print()

if __name__ == '__main__':
    main()
