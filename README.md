PanomNom.js
======================

Panorama fetching tools for JavaScript

Current supported sources
- Google Street View panoramas
- Google PhotoSpheres

Upcoming sources
- Yandex Street View
- Bing StreetSide

###How to use 

Include the library.

```javascript
<script src="PanomNom.min.js"></script>
```

Create a loader. There's two loaders, one for Street View panoramas and the other for PhotoSpheres:

```javascript
var loader = new PANOMNOM.GoogleStreetViewLoader();
var loader = new PANOMNOM.GooglePhotoSphereLoader();
```

Attach onLoad event listener (there's also progress and error):

```javascript
loader.addEventListener( 'load', function() {
    // Do whatever with this.canvas
} );
````

Start loading the panorama. There's several methods:

```javascript
/* Load from ID: pano id, zoom 3 */
loader.load( panoId, 3 );

/* Load from location: google.maps.LatLng, zoom default 1 */
loader.loadFromLocation( panoLatLng ); 

/* Load from URL: URL from maps.google.com, zoom 2 */
loader.loadFromURL( panoURL, 2 );
```

**Note: loader.loadFromLocation is only available for PANOMNOM.GoogleStreetViewLoader**

Please see the examples folder for proper implementations of each case.

#License

MIT licensed

Copyright (C) 2014 Jaume Sanchez Elias http://twitter.com/thespite

http://www.clicktorelease.com
