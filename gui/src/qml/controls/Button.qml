import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material

import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material

Button {
    property bool firstInFocusChain: false
    property bool lastInFocusChain: false
    property bool sendOutput: false

    background: Rectangle {
        anchors.fill: parent
        radius: 8
        color: parent.visualFocus ? Material.accent : (parent.flat ? "transparent" : Material.background)
        border.color: parent.visualFocus ? Material.accent : "transparent"
        border.width: parent.visualFocus ? 0 : 0
        Behavior on color { ColorAnimation { duration: 150 } }
    }

    contentItem: Label {
        text: qsTr(parent.text)
        color: parent.visualFocus ? "white" : Material.foreground
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }

    Component.onDestruction: {
        if (visualFocus) {
            let item = nextItemInFocusChain();
            if (item)
                item.forceActiveFocus(Qt.TabFocusReason);
        }
    }

    Keys.onPressed: (event) => {
        switch (event.key) {
        case Qt.Key_Up:
            if (!firstInFocusChain) {
                let item = nextItemInFocusChain(false);
                if (item)
                    item.forceActiveFocus(Qt.TabFocusReason);
                if(!sendOutput)
                    event.accepted = true;
            }
            break;
        case Qt.Key_Down:
            if (!lastInFocusChain) {
                let item = nextItemInFocusChain();
                if (item)
                    item.forceActiveFocus(Qt.TabFocusReason);
                if(!sendOutput)
                    event.accepted = true;
            }
            break;
        case Qt.Key_Return:
            if (visualFocus) {
                clicked();
            }
            event.accepted = true;
            break;
        }
    }
}
