// Utility for computing constants
function xy(x, y) {
    /*
     * Convert image-space pixel coords into map-space pseudo-lat-lng coords.
     */
    return new L.LatLng(-y * COORDINATE_MULTIPLIER, x * COORDINATE_MULTIPLIER);
}

// Constants
var WIDTH = 7933;
var HEIGHT = 4550;
var MIN_ZOOM = 0;
var MAX_ZOOM = 4;
var COORDINATE_MULTIPLIER = 1 / Math.pow(2, MAX_ZOOM - MIN_ZOOM);
var MIN_COORDS = new L.LatLng(0, 0);
var CENTER_COORDS = xy(WIDTH / 2, HEIGHT / 2);
var MAX_COORDS = xy(WIDTH, HEIGHT); 
var MARGIN = 100;
var MAX_BOUNDS = new L.LatLngBounds(xy(0, 0), xy(WIDTH, HEIGHT));
var VIGNETTE_WIDTH = 10000;
var VIGNETTE_HEIGHT = 5000;

var AUDIO_LENGTH = 950;
var PAN_DURATION = 2.0;

// Elements
var $superzoom;
var $nav;
var $topper;
var $audio;
var $progress;
var $next;
var $back;
var $player;
var $browse_btn;
var $current_cue;
var $current_time;
var $browse_list;
var $modal_intro;
var $start_btn;
var $modal_end;
var $end_btn;
var $vignette;

// State
var superzoom = null;
var zoom_control = null;
var num_cues = 0; 
var active_cue = 0;
var cue_data = [];
var pop = null;
var browse_list_open = false;
var icon = null;

function setup_superzoom() {
    /*
     * Setup the "map".
     */
    superzoom = L.map('superzoom', {
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: MAX_BOUNDS,
        crs: L.CRS.Simple,
        zoomControl: false,
        attributionControl: false
    });

    zoom_control = new L.Control.Zoom({
        position: 'topright'
    }).addTo(superzoom);

    //var tiles = L.tileLayer('/img/tiles/{z}/{x}/{y}.jpg', {
    var tiles = L.tileLayer('http://{s}.npr.org/okkervil/img/tiles/{z}/{x}/{y}.jpg', {
        //subdomains: ['apps', 'apps2'],
        subdomains: ['stage-apps'],
        continuousWorld: true,
        noWrap: true
    }).addTo(superzoom);
}

function superzoom_to(x, y, zoom) {
    /*
     * Zoom to a given x, y point (in pixel space).
     */
    var latlng = xy(x, y);

    // Compute sizes at target zoom level
    var zoomed = superzoom.project(latlng, zoom);
    var image_size = superzoom.project(MAX_COORDS, zoom);
    
    // Constrain x
    var width = $superzoom.width();
    var half_width = width / 2;

    if (zoomed.x < half_width) {
        zoomed.x = half_width;
    }

    if (zoomed.x > image_size.x - half_width) {
        zoomed.x = image_size.x - half_width;
    }

    // Constrain y
    var height = $superzoom.height();
    var half_height = height / 2;

    if (zoomed.y < half_height) {
        zoomed.y = half_height;
    }

    if (zoomed.y > image_size.y - half_height) {
        zoomed.y = image_size.y - half_height;
    }

    // Reproject back to latlng since that's what leaflet expects
    latlng = superzoom.unproject(zoomed, zoom); 

    superzoom.setView(latlng, zoom, {
        animate: true,
        pan: { duration: PAN_DURATION } 
    });
}

function freeze_superzoom() {
    /*
     * Disable pan/zoom controls.
     */
    superzoom.dragging.disable();
    superzoom.touchZoom.disable();
    superzoom.doubleClickZoom.disable();
    superzoom.scrollWheelZoom.disable();
    superzoom.boxZoom.disable();
    superzoom.keyboard.disable();

    if (superzoom.tap) {
        superzoom.tap.disable();
    }

    zoom_control.removeFrom(superzoom);
    $superzoom.addClass('frozen');

    superzoom.setMaxBounds(MAX_BOUNDS);

    // Restore cue position if we've been exploring mid-way through
    if (active_cue > 0 && active_cue < num_cues - 1) {
        goto_cue(active_cue);
    }
}

function unfreeze_superzoom() {
    /*
     * Enable pan/zoom controls.
     */
    superzoom.dragging.enable();
    superzoom.touchZoom.enable();
    superzoom.doubleClickZoom.enable();
    superzoom.scrollWheelZoom.enable();
    superzoom.boxZoom.enable();
    superzoom.keyboard.enable();

    if (superzoom.tap) {
        superzoom.tap.enable();
    }

    zoom_control.addTo(superzoom);
    $superzoom.removeClass('frozen');
    
    superzoom.setMaxBounds(null);

    // Clear vignette
    $vignette.hide();
}

function setup_jplayer() {
    /* 
     * Load audio player
     */
    $player.jPlayer({
        ready: function () {
            $(this).jPlayer('setMedia', {
                mp3: "http://stage-apps.npr.org/okkervil/audio/mega.mp3",
                //oga: "http://apps.npr.org/sotomayor-family-photos/narration.ogg"
            }).jPlayer("pause");

            load_cue_data();
        },
        play: function() {
            freeze_superzoom();
        },
        pause: function() {
            unfreeze_superzoom();
        },
        timeupdate: function(e) {
            var current_time = $.jPlayer.convertTime(e.jPlayer.status.currentTime);
            var elapsed_time = $.jPlayer.convertTime(Math.ceil(AUDIO_LENGTH- e.jPlayer.status.currentTime));
            var total_time = $.jPlayer.convertTime(Math.ceil(AUDIO_LENGTH));
            $current_time.text(current_time + ' / ' + total_time);
        },
        ended: function () {
            $(this).jPlayer("pause", AUDIO_LENGTH - 1);
        },
        swfPath: "js",
        supplied: "oga, mp3"
    });

    // Associate jPlayer with Popcorn
    pop = Popcorn('#jp_audio_0');
}

function load_cue_data() {
    /* 
     * Load cue data from external JSON.
     */
    var browse_output = '';
    
    $.getJSON('cues.json', function(data) {
        num_cues += data.length;
        
        $.each(data, function(id, cue) {
            cue['id'] = id;
            cue['show_number'] = (id != 0 && id != num_cues - 1);

            var bits = cue['cue'].split(':');
            cue['cue'] = (parseInt(bits[0]) * 60) + parseInt(bits[1]) + (parseInt(bits[2]) / 60);

            cue_data.push(cue);
            
            var cue_time = parseFloat(cue['cue']);
        
            // Markup for this cue and its entry in the cue nav
            // via Underscore template / JST
            browse_output += JST.browse(cue);

            // Popcorn cuepoint for this cue
            pop.code({
                start: cue_time,
                end: cue_time + 1,
                onStart: function(options) {         
                    goto_cue(id);

                    return false;
                }
            });
        });

        $browse_list.append(browse_output);

        $browse_list.find('.browse-0').click(open_intro_modal);
        $browse_list.find('.browse-cue:last').click(open_end_modal);

        update_current_cue(0);

        // Set initial map position
        superzoom.setView(xy(cue_data[0]['x'], cue_data[0]['y']), cue_data[0]['zoom']);
    });
}

function goto_cue(id) {
    /*
     * Jump to a cue and update all display info, including superzoom.
     */
    var cue = cue_data[id];
    var x = parseInt(cue['x']);
    var y = parseInt(cue['y']);

    $vignette.hide();

    if (id == 0) {
        $player.jPlayer('pause', cue['cue']);
        open_intro_modal();
    } else if (id == num_cues - 1) {
        $player.jPlayer('pause', cue['cue']);
        open_end_modal();
    } else {
        var handler = function() {
            var pos = xy(x, y);
            var pt = superzoom.project(pos, cue['zoom']);

            var bounds = superzoom.getBounds();
            var nw = bounds.getNorthWest();
            var nw_pt = superzoom.project(nw, cue['zoom']);

            var left = (pt.x - VIGNETTE_WIDTH / 2) - nw_pt.x;
            var top = (pt.y - VIGNETTE_HEIGHT / 2) - nw_pt.y;

            $vignette.css({
                'background-position': left + 'px ' + top + 'px'
            }).show();

            superzoom.off('moveend', handler);
        }

        superzoom.on('moveend', handler);
    }

    superzoom_to(x, y, cue['zoom']);

    update_current_cue(id);

    active_cue = id;
}

function update_current_cue(id) {
    /*
     * Update the display of the current cue name.
     */
    $('.browse-cue a').removeClass('active');
    $('.browse-' + id + ' a').addClass('active');

    var browse_text = $('.browse-' + id + ' a h2').text();
    $current_cue.text(browse_text);
}

function browse_list_toggle(mode) {
    /*
     * Open or close the cue list.
     */
    var browse_btn_position = $browse_btn.offset();
     
    if (browse_list_open || mode == 'close') {
        $browse_list.hide();
        $browse_btn.removeClass('active');
        browse_list_open = false;
    } else if (!browse_list_open || mode == 'open') {
        $browse_list.css('top', browse_btn_position.top + $browse_btn.height());
        $browse_list.css('left', browse_btn_position.left);
        $browse_list.show();
        $browse_btn.addClass('active');
        browse_list_open = true;
    }
}

function goto_next_cue() {
    /*
     * Jump to the next cue.
     */
    if (active_cue < (num_cues - 1)) {
        $modal_intro.modal('hide');

        var id = active_cue + 1;
        $player.jPlayer('play', cue_data[id]['cue']);
    }

    return false;
}

function goto_previous_cue() {
    /*
     * Jump to the previous cue.
     */
    if (active_cue > 0) {
        $modal_end.modal('hide');

        var id = active_cue - 1;
        $player.jPlayer('play', cue_data[id]['cue']);
    }

    return false;
}

function open_intro_modal() {
    browse_list_toggle('close');
    $modal_intro.modal();
    active_cue = 0;
}

function open_end_modal() {
    browse_list_toggle('close');
    $modal_end.modal();
    active_cue = num_cues - 1;
}

$(function() {
    // Get element refs
    $superzoom = $('#superzoom');
    $nav = $('#nav');
    $topper = $('#topper');
    $audio = $('#audio');
	$progress = $audio.find('.jp-progress-container');
	$next = $('#next-btn');
	$back = $('#back-btn');
	$player = $('#pop-audio');
	$browse_btn = $('#browse-btn');
    $current_cue = $('#current-cue');
    $current_time = $('#audio .current-time');
    $browse_list = $('#browse-list');
    $modal_intro = $('#modal-intro');
    $start_btn = $modal_intro.find('.play-btn');
    $modal_end = $('#modal-end');
    $end_btn = $modal_end.find('.play-btn');
    $vignette = $('#vignette');

    // Setup the zoomer
    setup_superzoom()

    // Setup the audio
    setup_jplayer();

    // Event handlers
	$browse_btn.click(browse_list_toggle);
	$browse_list.mouseleave(function() {
        browse_list_toggle('close');
    });
    $next.click(goto_next_cue);
	$back.click(goto_previous_cue);

    $start_btn.click(function() {
        $modal_intro.modal('hide');
        $player.jPlayer('play');
    });
    
    $end_btn.click(function() {
        $modal_end.modal('hide');
    });

    $browse_list.on('click', 'a', function() {
        var id = parseInt($(this).attr('data-id'));
        $player.jPlayer('play', cue_data[id]['cue']);
        browse_list_toggle('close');
    });

    // Keyboard controls 
    $(document).keydown(function(ev) {
        if (ev.which == 37) {
            goto_previous_cue();
            return false;
        } else if (ev.which == 39) {
            goto_next_cue();
            return false;
        } else if (ev.which == 32) {
            if ($player.data().jPlayer.status.paused) {
                $player.jPlayer('play');
            } else {
                $player.jPlayer('pause');
            }
            return false;
        }

        return true;
    });
});
