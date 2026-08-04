import os, re
base = r'D:\Workspace\individual\PrimeTop\docs2'
files = []
for root, dirs, fnames in os.walk(base):
    for f in fnames:
        if f.endswith('.md'):
            files.append(f.replace('.md',''))
keywords = [
'账号体系-注册登录','年级学段选择','AI 辅导 文字问答','AI 辅导 语音提问','连续追问','拍题答疑 拍照识别','拍题答疑 分步解析','拍题答疑 类题练习','同步课堂 教材目录','同步课堂 章节学习','错题本 错题收录','错因标签','学情分析 学习记录','学情分析 薄弱点分析','学习规划 每日任务','作文辅导 作文批改','文科背诵 背诵检测','启蒙学习 拼音识字','个人中心 会员状态','家长绑定','学情报告','使用管理 时长控制','内容范围','消息提醒','会员管理 订阅管理','用户管理 用户查询','内容管理 教材管理','内容管理 题库管理','AI 管理 Prompt 配置','AI 管理 模型配置','审核管理 内容审核','数据看板 运营数据','权限管理 角色权限'
]
for kw in keywords:
    pat = kw.replace(' ','').replace('-','').lower()
    matches = [f for f in files if pat in f.replace('-','').replace(' ','').lower()]
    print(f"{kw}: {len(matches)} {matches[:3]}")
