---
title: 重放攻击
category:
  - card
date: 2024-07-09
tags: [Entry,Computer-Science,Network,Security]
article: false
dg-publish: true
---
#Entry #Computer-Science #Network #OSI #Application-Layer


# Description

重放攻击指的是, 攻击者截获了通信双方的通信内容后, 将这些内容不加修改地再次发送给某一方, 来达到欺骗的目的.

比如双方在通信前发送了一个票据来作为查找[[Session]]的依据, 然后攻击者截获并发送了同样的内容到服务端, 希望用同一个Session来进行通信. 即便票据被加密了, 攻击者无法直接获取票据的内容, 但是服务器却无法分辨发送者的身份.