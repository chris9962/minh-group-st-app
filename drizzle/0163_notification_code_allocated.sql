-- Trưởng phòng chia mã giới thiệu cho nhân viên thì báo cho nhân viên đó (chốt 2026-11-08).
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'code-allocated';
