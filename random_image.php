<?php
// List of image URLs
$images = [
    "https://raw.githubusercontent.com/TanZng/TanZng/master/assets/hollor_knight3.gif",
    "https://raw.githubusercontent.com/anxiangsir/anxiangsir/master/knight_jump.gif",
    "https://raw.githubusercontent.com/anxiangsir/anxiangsir/master/knight_flower.gif"
];

// Select a random image
$randomImage = $images[array_rand($images)];

// Redirect to the random image
header("Location: $randomImage");
exit;
?>
