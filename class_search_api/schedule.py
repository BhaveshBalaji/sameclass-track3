"""Meeting normalization reused from the verified ClassCue integration.

Keep every meeting row and explicitly mark unparseable intervals unknown.
"""
from datetime import datetime
from html import unescape
import re
DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

def clean(value):
    if value is None:
        return ""
    return " ".join(unescape(re.sub(r"<[^>]*>", " ", str(value))).split())

def day_codes(value):
    text = clean(value).lower().replace(",", " ")
    if not text or text in {"tba", "arr", "arranged", "none"}:
        return []
    aliases = {"monday": "m", "mon": "m", "tuesday": "t", "tues": "t", "tue": "t",
               "wednesday": "w", "wed": "w", "thursday": "r", "thurs": "r", "thur": "r", "thu": "r",
               "friday": "f", "fri": "f", "saturday": "s", "sat": "s", "sunday": "u", "sun": "u"}
    for word, code in aliases.items():
        text = re.sub(r"\b" + word + r"\b", code, text)
    text = text.replace("th", "r").replace("tu", "t").replace("su", "u").replace("sa", "s")
    text = re.sub(r"[\s/;-]", "", text)
    if not re.fullmatch(r"[mtwrfsu]+", text):
        return []
    mapping = dict(zip("mtwrfsu", DAYS))
    return [day for day in DAYS if day in {mapping[c] for c in text}]

def date_string(value):
    value = clean(value)
    if not value:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return None

def clock(value):
    value = clean(value).upper()
    if not value:
        return None
    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).strftime("%H:%M")
        except ValueError:
            pass
    return None

def rows(value):
    if isinstance(value, list):
        return value
    return re.split(r"<br\s*/?>", str(value or ""), flags=re.I)

def meetings(raw):
    cl = raw["CLAS"]
    dates = cl.get("MEETINGDATES") or []
    if not isinstance(dates, list):
        dates = []
    starts = rows(cl.get("STARTTIMES") if cl.get("STARTTIMES") is not None else cl.get("STARTTIME"))
    ends = rows(cl.get("ENDTIMES") if cl.get("ENDTIMES") is not None else cl.get("ENDTIME"))
    days = rows(raw.get("DAYLIST") if raw.get("DAYLIST") is not None else cl.get("DAYLIST"))
    count = max(len(dates), len(starts), len(ends), len(days), 1)
    result = []
    for i in range(count):
        # Only section-level STARTDATE/ENDDATE can safely apply to every row.
        pair = dates[i] if i < len(dates) and isinstance(dates[i], list) else []
        start_date = date_string(pair[0]) if len(pair) >= 2 else date_string(cl.get("STARTDATE"))
        end_date = date_string(pair[1]) if len(pair) >= 2 else date_string(cl.get("ENDDATE"))
        start = clock(starts[i]) if i < len(starts) else None
        end = clock(ends[i]) if i < len(ends) else None
        codes = day_codes(days[i]) if i < len(days) else []
        known = bool(start and end and codes and start_date and end_date and start < end and start_date <= end_date)
        result.append({"days": codes, "start": start, "end": end, "start_date": start_date,
                       "end_date": end_date, "status": "scheduled" if known else "unknown"})
    return result
