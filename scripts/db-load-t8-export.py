"""Xuất sheet TỔNG của TÍNH ĐIỂM TỔNG T8.xlsx sang CSV cho `db-load-t8.sql`.

Chỉ giữ 16 cột mà script nạp cần. Bỏ dòng không có ngân hàng nào — chúng không
dựng được thành khách có tài khoản.
"""
import csv
import openpyxl

SRC = "../TÍNH ĐIỂM TỔNG T8.xlsx"
OUT = "/tmp/t8_stage.csv"
OPEN = {8: "MB", 9: "VPa", 10: "VPb", 11: "LPB", 12: "MSBa", 13: "MSBb", 14: "BIDV", 15: "TPB", 16: "VIB", 17: "SHB"}
APP = {21: "MB", 22: "VPa", 23: "LPB", 24: "MSBa", 25: "MSBb", 26: "BIDV", 27: "TPB", 28: "VIB", 29: "SHB"}

ws = openpyxl.load_workbook(SRC, data_only=True, read_only=True)["TỔNG"]
n = 0
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["stt", "name", "id_number", "phone", "day", "hamlet", "channel", "opened",
                "installed", "msb_stk", "household", "insurance", "plate", "beneficiary",
                "staff_code", "group_name"])
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < 3 or (r[0] is None and r[1] is None):
            continue
        g = lambda k: "" if r[k] is None else str(r[k]).strip()
        opened = [v for k, v in OPEN.items() if r[k] not in (None, "", 0)]
        if not opened:
            continue
        n += 1
        w.writerow([r[0], g(1), g(2), g(3), g(4), g(5), g(6), "|".join(opened),
                    "|".join(v for k, v in APP.items() if r[k] not in (None, "", 0)),
                    g(18), g(19), g(34), g(35), g(36), g(37), g(38)])
print(f"{n} dòng → {OUT}")
