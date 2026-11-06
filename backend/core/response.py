"""core/response.py —— 统一响应格式（与 main.py §1 保持同一约定）"""


def ok(data=None, msg="ok"):
    """成功响应：code = 0"""
    return {"code": 0, "msg": msg, "data": data}


def err(msg: str, data=None):
    """业务错误响应：code = 1（HTTP 仍为 200，前端只看 code）"""
    return {"code": 1, "msg": msg, "data": data}
