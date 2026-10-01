#!/usr/bin/env python3
"""LEDs and a live-visitor display for an entity's node, on a Raspberry Pi.

    python3 hardware/leds.py [entity directory]

Reads the node's event log (.entity/events.log) and shows:

    GPIO17 (pin 11)  green   an act was settled into the record
    GPIO27 (pin 13)  blue    someone opened the page
    GPIO22 (pin 15)  yellow  someone closed the page
    GPIO23 (pin 16)  red     an act was refused
    GPIO24 (pin 18)  white   an act arrived from a browser
    I2C (pins 3, 5)  display number of people with the page open now

Every LED: GPIO pin -> 330 ohm resistor -> LED long leg; LED short leg -> ground.
Change the pins below if you wire it differently.

Without a Pi (or without the libraries) it prints what it would do instead.
"""
import json, os, sys, time

PINS = {'settled': 17, 'visit': 27, 'leave': 22, 'refused': 23, 'act': 24}
BLINK = 0.4  # seconds each LED stays lit

directory = sys.argv[1] if len(sys.argv) > 1 else '.'
log = os.path.join(directory, '.entity', 'events.log')

try:
    from gpiozero import LED
    leds = {k: LED(pin) for k, pin in PINS.items()}
except Exception as e:
    print(f'(no GPIO: {e}; printing instead)')
    leds = {}

try:
    import board
    from adafruit_ht16k33.segments import Seg7x4
    display = Seg7x4(board.I2C())
    display.brightness = 0.5
except Exception as e:
    print(f'(no display: {e}; printing instead)')
    display = None

def flash(kind):
    if kind in leds:
        leds[kind].blink(on_time=BLINK, off_time=0, n=1, background=True)
    else:
        print(f'LED  {kind}')

def show(number):
    if display is not None:
        display.fill(0)
        display.print(str(max(0, number))[-4:].rjust(4))
    else:
        print(f'SHOW {number}')

def follow(path):
    """Yield new lines as they are written; survives the log being rotated."""
    existed = os.path.exists(path)
    while not os.path.exists(path):
        time.sleep(1)
    f = open(path)
    if existed:
        f.seek(0, os.SEEK_END)   # skip old events; a log created after we started is read whole
    inode = os.fstat(f.fileno()).st_ino
    while True:
        line = f.readline()
        if line:
            yield line
            continue
        time.sleep(0.2)
        try:
            if os.stat(path).st_ino != inode:
                f = open(path); inode = os.fstat(f.fileno()).st_ino
        except FileNotFoundError:
            pass

show(0)
print(f'watching {log}')
for line in follow(log):
    try:
        event = json.loads(line)
    except ValueError:
        continue
    kind = event.get('type')
    flash(kind)
    if 'live' in event:
        show(event['live'])
