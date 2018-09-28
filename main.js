; (function () {

    "use strict";

    var root = this;
    var has_require = typeof require !== 'underfined';

    var AFRAME = root.AFRAME || has_require && require('aframe');
    if (!AFRAME) {
        throw new Error('Components requires A-FRAME');
    }

    var EARTH_RADIUS = 6378160;
    var GPS_MAX_ACCURY = 100;
    var LINE_COORDS = null;

    function GPSUtils() { }

    GPSUtils.getGPSPosition = function (success, error, options) {
        if (typeof (error) == 'undefined')
            error = function (err) {
                console.warn('GPSUtils ERROR(' + err.code + '): ' + err.message);
            };

        if (!('geolocation' in navigator)) {
            error({ code: 0, message: 'Geolocation is not supported by your browser' });
            return;
        }

        return navigator.geolocation.watchPosition(
            success,
            error,
            {
                enableHighAccuracy: true,
                maximumAge: options.maximumAge,
                timeout: options.timeout
            }
        );
    }

    GPSUtils.calculateDistance = function (src, dest) {

        var dlng = THREE.Math.degToRad(dest.longitude - src.longitude);
        var dlat = THREE.Math.degToRad(dest.latitude - src.latitude);

        var alpha = (Math.sin(dlat / 2) * Math.sin(dlat / 2)) +
            Math.cos(THREE.Math.degToRad(src.latitude)) * Math.cos(THREE.Math.degToRad(dest.latitude)) * (Math.sin(dlng / 2) * Math.sin(dlng / 2));
        var angle = 2 * Math.atan2(Math.sqrt(alpha), Math.sqrt(1 - alpha));

        return angle * EARTH_RADIUS;
    }

    GPSUtils.getRelativePosition = function (position, zeroCoords, coords) {

        position.x = (GPSUtils.calculateDistance(zeroCoords, {
            longitude: coords.longitude,
            latitude: zeroCoords.latitude
        }) *
            (coords.longitude > zeroCoords.longitude ? 1 : -1));

        position.y = coords.altitude - zeroCoords.altitude;

        position.z = (GPSUtils.calculateDistance(zeroCoords, {
            longitude: zeroCoords.longitude,
            latitude: coords.latitude
        }) *
            (coords.latitude > zeroCoords.latitude ? -1 : 1));

        return position;
    }

    GPSUtils.clearWatch = function (watchId) {
        navigator.clearWatch(watchId);
    }

    function Road(points) {
        this.points = points;
        this.createMesh();
    }

    Road.prototype.extractRoadPoints = function (point1, point2) {

        // Vector from [point2] to [point1]
        var vector = {
            x: point2.x - point1.x,
            y: point2.y - point1.y,
            z: point2.z - point1.z,
        }

        var vOxz = {
            x: 0,
            y: 1,
            z: 0
        };

        var vectorVertices = {
            x: vector.y * vOxz.z - vector.z * vOxz.y,
            y: vector.z * vOxz.x - vector.x * vOxz.z,
            z: vector.x * vOxz.y - vector.y * vOxz.x,
        };

        var t = Math.sqrt(2 * 2 / (vectorVertices.x * vectorVertices.x + vectorVertices.y * vectorVertices.y + vectorVertices.z * vectorVertices.z));

        var sidePoint11 = {
            x: point1.x + vectorVertices.x * t,
            y: point1.y + vectorVertices.y * t,
            z: point1.z + vectorVertices.z * t,
        }

        var sidePoint12 = {
            x: point1.x - vectorVertices.x * t,
            y: point1.y - vectorVertices.y * t,
            z: point1.z - vectorVertices.z * t,
        }

        var sidePoint21 = {
            x: point2.x + vectorVertices.x * t,
            y: point2.y + vectorVertices.y * t,
            z: point2.z + vectorVertices.z * t,
        }

        var sidePoint22 = {
            x: point2.x - vectorVertices.x * t,
            y: point2.y - vectorVertices.y * t,
            z: point2.z - vectorVertices.z * t,
        }

        return [sidePoint11, sidePoint12, sidePoint21, sidePoint22];
    }

    // Create a THREE.Mesh for road drawing using THREE.CatmullRomCurve3 (point detection) and THREE.MeshBasicMaterial
    Road.prototype.createMesh = function () {
        if (!this.points) {
            throw new Error('Road points is not set');
        }

        var geometry = new THREE.Geometry();

        var points = [];
        this.points.forEach(point => {
            points.push(new THREE.Vector3(point.x, point.y, point.z));
        });

        // Create a closed wavey loop
        var curve = new THREE.CatmullRomCurve3(points);

        var material = new THREE.MeshBasicMaterial({ vertexColors: THREE.FaceColors, side: THREE.DoubleSide, opacity: 0.2 });

        // Create a triangular geometry
        points = curve.getPoints(100 * points.length);

        var roadPoints = [];

        var length = points.length;

        for (var i = 0; i < length - 1; i++) {
            roadPoints = roadPoints.concat(this.extractRoadPoints(points[i], points[i + 1]));
        }

        roadPoints = roadPoints.concat(this.extractRoadPoints(points[length - 1], points[length - 2]));

        for (var i = 0; i < roadPoints.length; i++) {
            var face = new THREE.Face3(i, i + 1, i + 2);
            geometry.vertices.push(new THREE.Vector3(roadPoints[i].x, roadPoints[i].y, roadPoints[i].z));

            if (i < roadPoints.length - 2) {
                //face.color.set(new THREE.Color(Math.random() * 0xffffff - 1));
                face.color.set(new THREE.Color(0xF98181));
                geometry.faces.push(face);
            }
        }

        // The face normals and vertex normals can be calculated automatically if not supplied above
        geometry.computeFaceNormals();
        geometry.computeVertexNormals();

        this.mesh = new THREE.Mesh(geometry, material);
    }

    // Component
    AFRAME.registerComponent('gps-position', {

        watchId: null,
        zeroCoords: null,
        coords: null,

        schema: {
            accuracy: {
                type: 'int',
                default: GPS_MAX_ACCURY
            },
            'zero-crd-latitude': {
                type: 'number',
                default: NaN
            },
            'zero-crd-longitude': {
                type: 'number',
                default: NaN
            }
        },

        init: function () {
            // Set coordinate of the O point (x, y, x) = (0, 0, 0) if it is preset in code
            if (!isNaN(this.data['zero-crd-latitude']) && !isNaN(this.data['zero-crd-longitude'])) {
                this.zeroCoords = {
                    latitude: this.data['zero-crd-latitude'],
                    longitude: this.data['zero-crd-longitude']
                };
            }

            // Get and save the result of 'navigator.geolocation.watchPosition'  as watching id
            this.watchId = this.watchGPS(this.watchGPSSuccess.bind(this));
        },

        watchGPS: function (success, error) {
            return GPSUtils.getGPSPosition(success, error, { maximumAge: 0, timeout: 27000 });
        },

        watchGPSSuccess: function (position) {
            // After watching position successfully, update coordinate of component
            this.coords = position.coords;
            // Update relative position in AR/VR scence
            this.updatePosition();
        },

        updatePosition: function () {
            if (this.coords.accuracy > this.data.accuracy) { return; }

            if (this.zeroCoords == null) {
                this.zeroCoords = this.coords;
                this.zeroCoords.altitude = 0;
            }

            // set y = 0.5 for testing
            // this.coords.altitude = this.zeroCoords.altitude + 0.5;

            var p = GPSUtils.getRelativePosition(this.el.getAttribute('position'), this.zeroCoords, this.coords);
            p.y = 0;

            // document.querySelector("#crd_longitude").innerText = this.coords.longitude;
            // document.querySelector("#crd_latitude").innerText = this.coords.latitude;

            // document.querySelector("#crd_x").innerText = p.x;
            // document.querySelector("#crd_y").innerText = p.y;
            // document.querySelector("#crd_z").innerText = p.z;

            // document.querySelector("#zero_crd_longitude").innerText = this.zeroCoords.longitude;
            // document.querySelector("#zero_crd_latitude").innerText = this.zeroCoords.latitude;
            // document.querySelector("#zero_y").innerText = this.zeroCoords.altitude;
            document.querySelector("#crd_accuracy").innerText = this.coords.accuracy;

            if (LINE_COORDS != null) {
                document.querySelector("#line_distance").innerText = GPSUtils.calculateDistance(this.coords, LINE_COORDS);
            }

            this.el.setAttribute('position', p);
        },

        remove: function () {
            if (this.watchId) {
                GPSUtils.clearWatch(watchId);
            }
            this.watchId = null;
        }

    });

    AFRAME.registerComponent('compass-rotation', {
		compassdir: null,
		
        schema: {
            fixTime: {
                type: 'int',
                default: 100
            },
            orientationEvent: {
                type: 'string',
                default: 'auto'
            }
        },

        init: function () {

            var initSetting = this.data.orientationEvent;

            if (initSetting == 'auto') {
                var userAgent = navigator.userAgent || navigator.vendor || window.opera;

                // iOS detection from: http://stackoverflow.com/a/9039885/177710
                let isIOS = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;

                document.querySelector("#test_el").innerText = "iOS: " + (isIOS ? "true" : "false");

                if(isIOS && 'ondeviceorientation' in window){
                    this.data.orientationEvent = 'deviceorientation';
                } else if ('ondeviceorientationabsolute' in window) {
                    this.data.orientationEvent = 'deviceorientationabsolute';
                } else if ('ondeviceorientation' in window) {
                    this.data.orientationEvent = 'deviceorientation';
                } else {
                    this.data.orientationEvent = '';
                    console.error('Compass not supported');
                    return;
                }
            }

            window.addEventListener(this.data.orientationEvent, this.handlerOrientation.bind(this), false);

            //Event listener for 'compassneedscalibration'
            window.addEventListener(
                'compassneedscalibration',
                function (event) {
                    alert('Your compass needs calibrating! Wave your device in a figure-eight motion.');
                    event.preventDefault();
                },
                true);
        },

        handlerOrientation: function (evt) {
			var alpha_alt = evt.alpha;
			
			if(this.compassdir == null && event.webkitCompassHeading != null) {
				// Apple works only with this, alpha doesn't work
				compassdir = event.webkitCompassHeading;  
				alpha_alt = 360 - compassdir;
			}
			
			document.querySelector("#test_el2").innerText = "9compassdir: " + compassdir + "\nAlpha: " + alpha_alt;
		
            this.el.object3D.quaternion.setFromEuler(new THREE.Euler(THREE.Math.degToRad(evt.beta), THREE.Math.degToRad(alpha_alt), -THREE.Math.degToRad(evt.gamma), 'YXZ'));
            this.el.object3D.quaternion.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));  // X軸を中心に90度回転します。
        },

        remove: function () {
            if (this.data.orientationEvent) {
                window.removeEventListener(this.data.orientationEvent, this.handlerOrientation, false);
            }
        }
    });

    AFRAME.registerComponent('road', {
        cameraGpsPosition: null,
        deferredInitIntervalId: 0,

        schema: {
            latitude: {
                type: 'number',
                default: 0
            },
            longitude: {
                type: 'number',
                default: 0
            },
            cameraSelector: {
                type: 'string',
                default: 'a-camera, [camera]'
            }
        },

        // Path
        points: [
            { latitude: 21.046368, longitude: 105.794631, altitude: 0 },
            { latitude: 21.046283, longitude: 105.795146, altitude: 10 },
            { latitude: 21.046399, longitude: 105.795743, altitude: 0 }
        ],

        init: function () {
            if (this.deferredInit()) { return; }

            this.deferredInitIntervalId = setInterval(this.deferredInit.bind(this), 1000);
        },

        // Try go get GPS position for zero coords
        deferredInit: function () {

            if (!this.cameraGpsPosition) {
                var camera = document.querySelector(this.data.cameraSelector);
                if (typeof (camera.components['gps-position']) == 'undefined') { return; }
                this.cameraGpsPosition = camera.components['gps-position'];
            }

            if (!this.cameraGpsPosition.zeroCoords) { return; }

            this.updatePosition();

            clearInterval(this.deferredInitIntervalId);
            this.deferredInitIntervalId = 0;

            return true;
        },

        updatePosition: function () {
            if (this.points) {
                var relativePoints = [];

                this.points.forEach(point => {
                    var p = { x: 0, y: 0, z: 0 };

                    // set altitude = 0 for testing
                    //point.altitude = this.cameraGpsPosition.zeroCoords.altitude;

                    GPSUtils.getRelativePosition(p, this.cameraGpsPosition.zeroCoords, point);
                    relativePoints.push(p);
                    // document.querySelector("#line_crd_longitude").innerText = point.longitude;
                    // document.querySelector("#line_crd_latitude").innerText = point.latitude;
                    // document.querySelector("#line_x").innerText = p.x;
                    // document.querySelector("#line_y").innerText = p.y;
                    // document.querySelector("#line_z").innerText = p.z;

                    LINE_COORDS = point;
                });

                // Change to meshline
                var roadMesh = new Road(relativePoints);

                this.el.setObject3D('mesh', roadMesh.mesh);
            }
        }
    });

}).call(this);