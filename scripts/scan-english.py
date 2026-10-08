"""Ad-hoc scanner that lists user facing English text still present in the app."""
import pathlib
import re

WORDS = [
    "Weekly", "Cycle", "Reward", "Referral", "Balance", "Withdraw", "Ledger",
    "Membership", "Tier", "Program", "Join", "Login", "Logout", "Register",
    "Password", "Email", "Total", "Available", "Pending", "Approved", "Rejected",
    "Posted", "History", "Progress", "Network", "Dashboard", "Overview",
    "Status", "Amount", "Description", "Date", "Type", "Name", "Success",
    "Error", "Failed", "Invalid", "Required", "Please", "Welcome", "Sign",
    "Forgot", "Reset", "Loading", "Save", "Cancel", "Submit", "Search",
    "Filter", "Show", "Hide", "Add", "Edit", "Delete", "Update", "Create",
    "Back", "Next", "Previous", "Username", "Phone", "Confirm", "already",
    "not found", "Unable", "must be", "at least", "characters",
]

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.tsx"))
TARGETS += list((ROOT / "tests").rglob("*.ts"))
TARGETS += list((ROOT / "scripts").rglob("*.ts"))
TARGETS += [ROOT / "prisma" / "seed.ts"]

pattern = re.compile(r"([\"'>`])\s*(" + "|".join(re.escape(w) for w in WORDS) + r")\b")

for path in TARGETS:
    text = path.read_text(encoding="utf-8", errors="ignore")
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        if pattern.search(line):
            print(f"{path.relative_to(ROOT)}:{number}: {stripped[:160]}")
