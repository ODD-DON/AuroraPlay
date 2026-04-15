import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Controls.Material
import "controls" as C

Dialog {
    id: dialog
    property alias text: label.text
    property var callback
    property var rejectCallback
    property bool newDialogOpen: false
    property Item restoreFocusItem
    parent: Overlay.overlay
    x: Math.round((root.width - width) / 2)
    y: Math.round((root.height - height) / 2)
    modal: true
    Material.roundedScale: Material.MediumScale
    onOpened: label.forceActiveFocus(Qt.TabFocusReason)
    onAccepted: {
        newDialogOpen = true;
        restoreFocus();
        callback();
    }
    onClosed: if(!newDialogOpen) { restoreFocus() }

    onRejected: {
        if(rejectCallback)
        {
            newDialogOpen = true;
            restoreFocus();
            rejectCallback();
        }
    }

    function restoreFocus() {
        if (restoreFocusItem)
            restoreFocusItem.forceActiveFocus(Qt.TabFocusReason);
        label.focus = false;
    }

    Component.onCompleted: {
        header.horizontalAlignment = Text.AlignHCenter;
        // Qt 6.6: Workaround dialog background becoming immediately transparent during close animation
        header.background = null;
    }

    ColumnLayout {
        spacing: 16

        Image { source: "qrc:/icons/auroraplay.svg"; width: 56; height: 56; anchors.horizontalCenter: parent.horizontalCenter }

        Label {
            id: label
            wrapMode: Text.Wrap
            horizontalAlignment: Text.AlignHCenter
            Keys.onEscapePressed: dialog.reject()
            Keys.onReturnPressed: dialog.accept()
        }

        RowLayout {
            Layout.alignment: Qt.AlignCenter
            spacing: 12

            Button { text: qsTr("Yes"); onClicked: dialog.accept(); }
            Button { text: qsTr("No"); onClicked: dialog.reject(); }
        }
    }
}
