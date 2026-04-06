#!/usr/bin/env python3
"""
SpendSense App Icon Generator
Generates Android app icons in all required sizes with purple background and white "S"
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Icon sizes for different screen densities
SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

# SpendSense brand color (purple)
BACKGROUND_COLOR = (124, 58, 237, 255)  # #7c3aed
TEXT_COLOR = (255, 255, 255, 255)  # White

def generate_icon(size, output_path):
    """Generate a single icon with specified size"""
    # Create image with purple background
    img = Image.new('RGBA', (size, size), BACKGROUND_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Calculate font size (60% of icon size)
    font_size = int(size * 0.6)
    
    # Try to load a bold font, fallback to default
    font = None
    font_paths = [
        "C:/Windows/Fonts/arialbd.ttf",  # Windows
        "/System/Library/Fonts/Helvetica.ttc",  # macOS
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
        "arial.ttf",
        "Arial.ttf",
    ]
    
    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, font_size)
            print(f"Using font: {font_path}")
            break
        except:
            continue
    
    if font is None:
        print("Warning: Could not load custom font, using default")
        font = ImageFont.load_default()
    
    # Draw white "S" in center
    text = "S"
    
    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate centered position
    x = (size - text_width) / 2
    y = (size - text_height) / 2 - bbox[1]
    
    # Draw text
    draw.text((x, y), text, fill=TEXT_COLOR, font=font)
    
    # Save icon
    img.save(output_path)
    print(f"Generated: {output_path}")

def main():
    """Generate all icon sizes"""
    print("SpendSense Icon Generator")
    print("=" * 50)
    
    base_path = "android/app/src/main/res"
    
    # Check if android directory exists
    if not os.path.exists("android"):
        print("Error: android directory not found!")
        print("Please run this script from the project root directory.")
        return
    
    generated_count = 0
    
    for folder, size in SIZES.items():
        # Create directory if it doesn't exist
        folder_path = os.path.join(base_path, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # Generate regular icon
        icon_path = os.path.join(folder_path, "ic_launcher.png")
        generate_icon(size, icon_path)
        generated_count += 1
        
        # Generate round icon (same as regular for simplicity)
        round_icon_path = os.path.join(folder_path, "ic_launcher_round.png")
        generate_icon(size, round_icon_path)
        generated_count += 1
    
    print("=" * 50)
    print(f"✅ Successfully generated {generated_count} icon files!")
    print("\nNext steps:")
    print("1. Rebuild the app: cd android && ./gradlew clean assembleRelease")
    print("2. Or run: npx react-native run-android")
    print("\nThe new SpendSense icon will appear on your device!")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}")
        print("\nMake sure you have Pillow installed:")
        print("pip install Pillow")
