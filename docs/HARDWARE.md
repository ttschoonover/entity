# Lights and a live counter on a Raspberry Pi

LEDs that flash when the node settles an act, when someone opens or closes the
page, when an act arrives or is refused; and a 4-digit display showing how many
people have the page open right now.

## Buy

| Item | Notes |
|---|---|
| Half-size breadboard | |
| 5 LEDs: green, blue, yellow, red, white | any 5 mm LEDs |
| 5 × 330 Ω resistors | one per LED |
| Female-to-male jumper wires, ~10 | Pi header (female) to breadboard (male) |
| 4-digit 7-segment display with I2C backpack (HT16K33), e.g. Adafruit 0.56" | some versions need headers soldered on; a STEMMA QT version plugs in with a cable instead |

## Wire

Physical pin numbers on the Pi's 40-pin header (pin 1 is nearest the SD card slot, on the inner row):

| Pi pin | GPIO | To |
|---|---|---|
| 11 | GPIO17 | resistor → **green** LED long leg (settled) |
| 13 | GPIO27 | resistor → **blue** LED long leg (someone opened the page) |
| 15 | GPIO22 | resistor → **yellow** LED long leg (someone closed the page) |
| 16 | GPIO23 | resistor → **red** LED long leg (act refused) |
| 18 | GPIO24 | resistor → **white** LED long leg (act arrived) |
| 6 | GND | breadboard ground rail; every LED's short leg goes here |
| 1 | 3.3 V | display **VCC** (use 3.3 V, not 5 V: the Pi's pins are not 5 V tolerant) |
| 3 | SDA | display **SDA** (D) |
| 5 | SCL | display **SCL** (C) |
| 9 | GND | display **GND** |

An LED only lights one way round: long leg towards the Pi's GPIO pin, short leg to ground.

## Set up the Pi

```sh
sudo raspi-config nonint do_i2c 0                    # turn on I2C, for the display
sudo apt-get install -y python3-gpiozero python3-venv
python3 -m venv --system-site-packages ~/leds-env
~/leds-env/bin/pip install adafruit-circuitpython-ht16k33
```

## Run

The node writes its events to `.entity/events.log`; the script watches that file.

```sh
cd ~/entities/riverside-bakery
entity serve --settle &                              # or your usual serve + sync setup
~/leds-env/bin/python hardware/leds.py .
```

To test the lights without anyone visiting, write events by hand in another terminal:

```sh
echo '{"type":"visit","live":3}' >> .entity/events.log
echo '{"type":"settled"}'        >> .entity/events.log
```

## Notes

- The count comes from open pages holding a connection to the node. Pages from a
  static copy (`entity build`) do not count, and a tunnel that buffers streaming
  responses may not pass it through: Cloudflare's quick tunnels have not been
  tested with it here.
- Nothing about visitors is recorded: only that a page opened or closed, and the count.
- Written and tested with simulated pins; not yet run on real hardware.
