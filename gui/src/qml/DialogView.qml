import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Controls.Material

Item {
    id: dialog
    property alias header: headerLabel.text
    property alias title: titleLabel.text
    property alias buttonText: okButton.text
    property alias buttonEnabled: okButton.enabled
    property alias buttonVisible: okButton.visible
    property Item restoreFocusItem
    default property Item mainItem: null

    signal accepted()
    signal rejected()

    function close() {
        root.closeDialog();
    }

    Keys.onEscapePressed: close()

    Keys.onMenuPressed: {
        if (okButton.enabled)
            okButton.clicked()
    }

    StackView.onDeactivating: {
        restoreFocusItem = Window.window.activeFocusItem;
    }

    StackView.onActivated: {
        if (!restoreFocusItem) {
            let item = mainItem.nextItemInFocusChain();
            if (item)
                item.forceActiveFocus(Qt.TabFocusReason);
        } else {
            restoreFocusItem.forceActiveFocus(Qt.TabFocusReason);
            restoreFocusItem = null;
        }
    }

    onMainItemChanged: {
        if (mainItem) {
            mainItem.parent = contentItem;
            mainItem.anchors.fill = contentItem;
        }
    }

    ToolBar {
        id: toolBar
        anchors {
            top: parent.top
            left: parent.left
            right: parent.right
        }
        height: 72

        RowLayout {
            anchors.fill: parent
            anchors.margins: 10

            Button {
                Layout.preferredWidth: 60
                flat: true
                text: "❮"
                onClicked: {
                    dialog.rejected();
                    dialog.close();
                }
            }

            Image { source: "qrc:/icons/auroraplay.svg"; width: 44; height: 44 }

            Label {
                id: titleLabel
                text: ""
                font.bold: true
                font.pixelSize: 20
                verticalAlignment: Text.AlignVCenter
            }

            Item { Layout.fillWidth: true }

            Label {
                id: headerLabel
                text: ""
                font.pixelSize: 12
                verticalAlignment: Text.AlignVCenter
                color: Qt.rgba(1,1,1,0.6)
            }

            Button {
                id: okButton
                text: ""
                flat: false
                padding: 12
                font.pixelSize: 14
                onClicked: dialog.accepted()
            }
        }
    }

    Item {
        id: contentItem
        anchors {
            top: toolBar.bottom
            left: parent.left
            right: parent.right
            bottom: parent.bottom
        }
    }
}
